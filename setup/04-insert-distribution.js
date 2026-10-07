// 04-insert-distribution.js
//
// Ejecutar DENTRO de `taller-bd-mongos` via `docker exec -i taller-bd-mongos mongosh ...`.
//
// Inserta docs semilla MINIMOS para materializar la distribucion entre los 2 shards.
// Sin docs, los chunks existen vacios pero la distribucion no se ve en getShardDistribution().
//
// Por que split+move MANUAL y no autosplit:
//   - Despues de enable-sharding, cada coleccion shardeada tiene UN SOLO chunk inicial
//     que cubre todo el rango de la sharding key ([MinKey, MaxKey]).
//   - Ese chunk vive en algun shard (el que recibio el primer insert).
//   - Con solo 4 docs (~500 bytes cada uno), el autosplit NO se dispara (default
//     chunk size = 128MB).
//   - Sin split, ambos shards quedan con chunks asignados pero solo UNO tendra docs;
//     el otro tendra el chunk pero estara vacio -> el getShardDistribution mostraria
//     distribucion 4/0, no 2/2.
//
// GOTCHA de MongoDB 7 al listar chunks:
//   - config.chunks YA NO tiene campo `ns`. El namespace se guarda como `uuid`.
//   - Para listar los chunks de un NS hay que:
//       1. Buscar el UUID en config.collections ({_id: "db.coll"}).
//       2. Buscar en config.chunks con {uuid: <UUID>}.
//
// GOTCHA de upsert sobre coleccion shardeada:
//   - updateOne({_id: X}, ..., {upsert:true}) sobre una coleccion shardeada requiere
//     que el filtro incluya la SHARDING KEY. Si no, MongoDB no puede rutear la op al
//     shard correcto y tira "could not extract exact shard key".
//   - Solucion: filtrar por `{_id: X, <shardKey>: <value>}`.
//
// GOTCHA de moveChunk + docs pre-existentes:
//   - Si los docs se insertan ANTES del moveChunk, los originales quedan en el shard
//     origen como huerfanos despues del move (MongoDB los borra en background cada
//     ~60s via cleanupOrphaned, pero hasta entonces getShardDistribution los cuenta
//     como "owned" del shard origen).
//   - Solucion: hacer el split+move PRIMERO y los inserts DESPUES. Asi los docs
//     caen al shard correcto segun el routing de la sharding key, sin huerfanos.
//
// Para garantizar que el taller vea chunks CON DATOS en ambos shards desde el primer
// momento, hacemos split+move MANUAL + inserts posteriores:
//   1. Split del chunk inicial en 2 mitades usando un valor medio.
//   2. Move del primer chunk al OTRO shard (el que NO contiene ya el chunk, para
//      garantizar distribucion real entre ambos).
//   3. Insert de 4 docs semilla (uno por pais / uno por user_id) — incluye shard
//      key en el filtro para que MongoDB pueda rutear el upsert al shard correcto.
//   4. Verificacion con getShardDistribution().
//
// Split points elegidos para 2/2:
//   - usuarios shardeada por {pais:1}:    split at {pais:"ES"}
//       chunk1 = [MinKey,"ES") = {AR,CO}     (2 docs)
//       chunk2 = ["ES",MaxKey) = {ES,MX}     (2 docs)
//   - eventos  shardeada por {user_id:1}: split at {user_id:"seed-ES"}
//       chunk1 = [MinKey,"seed-ES") = {seed-AR,seed-CO}  (2 docs)
//       chunk2 = ["seed-ES",MaxKey) = {seed-ES,seed-MX}  (2 docs)
//
// Importante sobre sharding ranged de strings:
//   - MongoDB NO usa hash para ranged sharding (solo para hashed sharding). Para
//     {pais:1} ranged, la comparacion es LEXICOGRAFICA pura sobre el string.
//   - "AR" < "CO" < "ES" < "MX" en orden alfabetico ASCII.
//   - Por eso split en "ES" parte exactamente 2/2.
//   - Si la cardinalidad fuera muy baja (pocos valores), autosplit NUNCA dispararia
//     y la distribucion quedaria en 1 solo shard -> por eso el manual.
//
// Idempotente:
//   - upsert por _id fijo sobre datos identicos -> no-op si ya existe.
//   - split: si el split point ya existe, MongoDB tira "split point is on a chunk
//     boundary" — lo tratamos como OK.
//   - moveChunk: si el chunk ya esta en el destino, MongoDB responde {ok:1, note}
//     o "destination shard is the same as source" — lo tratamos como OK.

const perfil    = db.getSiblingDB("taller_perfiles");
const actividad = db.getSiblingDB("taller_actividad");
const configDb  = db.getSiblingDB("config");

const seedUsers = [
  { _id: "seed-AR", nombre: "Ana Ramirez",  email: "ana@example.com",   pais: "AR", fecha_registro: new Date("2024-01-15T00:00:00Z") },
  { _id: "seed-MX", nombre: "Mario Lopez",  email: "mario@example.com", pais: "MX", fecha_registro: new Date("2024-02-20T00:00:00Z") },
  { _id: "seed-CO", nombre: "Camila Ortiz", email: "camila@example.com",pais: "CO", fecha_registro: new Date("2024-03-10T00:00:00Z") },
  { _id: "seed-ES", nombre: "Eva Sanchez",  email: "eva@example.com",   pais: "ES", fecha_registro: new Date("2024-04-05T00:00:00Z") },
];

const seedEvents = [
  { _id: "evt-001", user_id: "seed-AR", tipo: "login",  payload: { ip: "10.0.0.1" }, timestamp: new Date("2024-05-01T10:00:00Z") },
  { _id: "evt-002", user_id: "seed-MX", tipo: "click",  payload: { boton: "home" },  timestamp: new Date("2024-05-02T11:00:00Z") },
  { _id: "evt-003", user_id: "seed-CO", tipo: "compra", payload: { total: 99.99 },  timestamp: new Date("2024-05-03T12:00:00Z") },
  { _id: "evt-004", user_id: "seed-ES", tipo: "logout", payload: {},               timestamp: new Date("2024-05-04T13:00:00Z") },
];

// Helper: lista chunks de un NS en MongoDB 7 (donde `ns` ya no existe en config.chunks).
function listChunksForNs(ns) {
  const collMeta = configDb.getCollection("collections").findOne({ _id: ns });
  if (!collMeta) return [];
  return configDb.getCollection("chunks").find({ uuid: collMeta.uuid }).toArray();
}

// Helper: lista shards del cluster.
function listShardIds() {
  return configDb.getCollection("shards").find().toArray().map((s) => s._id);
}

function forceTwoWayDistribution(ns, splitMiddle) {
  print(`\n[seed-distribution] ${ns}: forzando split + move`);

  let chunks = listChunksForNs(ns);
  print(`  chunks antes: ${chunks.length}`);
  chunks.forEach((c) => print(`    ${JSON.stringify(c.min)} -> ${JSON.stringify(c.max)} @ ${c.shard}`));

  // 1. Split si hay un solo chunk. Si el split point ya existe (re-corrida),
  //    MongoDB tira "split point is on a chunk boundary" — lo tratamos como OK.
  if (chunks.length < 2) {
    print(`  Ejecutando split: ${ns} at ${JSON.stringify(splitMiddle)} ...`);
    const splitRes = db.adminCommand({ split: ns, middle: splitMiddle });
    if (!splitRes || splitRes.ok !== 1) {
      const msg = (splitRes && splitRes.errmsg) || JSON.stringify(splitRes);
      if (/chunk boundary/i.test(msg)) {
        print(`  Split point ya existente, no-op.`);
      } else {
        print(`  [WARN] split no exitoso: ${msg}`);
      }
    } else {
      print(`  Split OK`);
    }
    chunks = listChunksForNs(ns);
    print(`  chunks despues del split: ${chunks.length}`);
    chunks.forEach((c) => print(`    ${JSON.stringify(c.min)} -> ${JSON.stringify(c.max)} @ ${c.shard}`));
  } else {
    print(`  Ya hay ${chunks.length} chunks. Skip split.`);
  }

  // 2. Move si todos los chunks siguen en un solo shard. Elegimos como destino
  //    el PRIMER shard del cluster que NO tenga chunks — asi no importa cual fue
  //    el shard inicial.
  const distinctShards = [...new Set(chunks.map((c) => c.shard))];
  if (distinctShards.length >= 2) {
    print(`  Ya hay chunks en ${distinctShards.join(", ")}. Skip move.`);
    return;
  }
  const allShards = listShardIds();
  const targetShard = allShards.find((s) => !distinctShards.includes(s));
  if (!targetShard) {
    print(`  [WARN] No hay un shard alternativo. Skip move.`);
    return;
  }
  print(`  Todos los chunks en ${distinctShards.join(", ")}. Moviendo uno a '${targetShard}' ...`);
  // Para elegir que chunk mover, usamos el primer chunk (que es el que cubre el
  // rango "bajo" segun el split point — tipicamente contiene los valores
  // lexicograficamente menores).
  const chunkToMove = chunks[0];
  // moveChunk requiere un "find" que matchee un doc del chunko. Como todavia no
  // insertamos nada, usamos un doc synthetic que cae en ese chunko.
  const syntheticMin = chunkToMove.min;
  const findDoc = {};
  for (const [k, v] of Object.entries(syntheticMin)) {
    findDoc[k] = (typeof v === "object") ? "a" : v;  // "a" cae en cualquier rango lex bajo
  }
  const moveRes = db.adminCommand({
    moveChunk: ns,
    find: findDoc,
    to: targetShard,
    _secondaryThrottle: false,
  });
  if (!moveRes || moveRes.ok !== 1) {
    const msg = (moveRes && moveRes.errmsg) || JSON.stringify(moveRes);
    if (/same as source|destination shard/i.test(msg)) {
      print(`  moveChunk: chunk ya estaba en destino. No-op.`);
    } else {
      print(`  [WARN] moveChunk no exitoso: ${msg}`);
    }
  } else {
    print(`  moveChunk OK`);
  }

  chunks = listChunksForNs(ns);
  print(`  chunks finales:`);
  chunks.forEach((c) => print(`    ${JSON.stringify(c.min)} -> ${JSON.stringify(c.max)} @ ${c.shard}`));
}

// 1. Split + move de cada coleccion ANTES de insertar docs. Asi los docs van al
//    shard correcto segun su shard key, sin huerfanos.
forceTwoWayDistribution(
  "taller_perfiles.usuarios",
  { pais: "ES" }
);

forceTwoWayDistribution(
  "taller_actividad.eventos",
  { user_id: "seed-ES" }
);

// 2. Insertar los seed docs DESPUES del split+move. Como los chunks ya estan en
//    ambos shards, los upserts caen en el shard correcto segun la sharding key
//    sin generar huerfanos.
print("\n[seed-distribution] Insertando 4 usuarios semilla (AR/MX/CO/ES) ...");
for (const u of seedUsers) {
  // IMPORTANTE: incluir `pais` en el filtro para que MongoDB pueda rutear el upsert
  // al shard correcto (la sharding key es {pais:1}).
  const r = perfil.usuarios.updateOne(
    { _id: u._id, pais: u.pais },
    { $set: { nombre: u.nombre, email: u.email, pais: u.pais, fecha_registro: u.fecha_registro } },
    { upsert: true }
  );
  print(`  ${u._id} (pais=${u.pais}): upsertedId=${r.upsertedId ? r.upsertedId._id : "—"}, modified=${r.modifiedCount}`);
}

print("\n[seed-distribution] Insertando 4 eventos semilla (uno por usuario) ...");
for (const e of seedEvents) {
  // Incluir `user_id` en el filtro (sharding key de eventos es {user_id:1}).
  const r = actividad.eventos.updateOne(
    { _id: e._id, user_id: e.user_id },
    { $set: { user_id: e.user_id, tipo: e.tipo, payload: e.payload, timestamp: e.timestamp } },
    { upsert: true }
  );
  print(`  ${e._id} (user_id=${e.user_id}): upsertedId=${r.upsertedId ? r.upsertedId._id : "—"}, modified=${r.modifiedCount}`);
}

print("\n[seed-distribution] ===== getShardDistribution(): usuarios =====");
perfil.usuarios.getShardDistribution();

print("\n[seed-distribution] ===== getShardDistribution(): eventos =====");
actividad.eventos.getShardDistribution();

print("\n[seed-distribution] sh.status() final:");
sh.status();