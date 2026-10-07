// 05-seed.js
//
// Ejecutar DENTRO de `taller-bd-mongos` via `docker exec -i taller-bd-mongos mongosh ...`.
//
// Seed MASIVO para el cluster del taller. Genera volumen realista para que la
// distribucion del sharding horizontal se vea VISUALMENTE significativa en
// `getShardDistribution()`, no solo tecnicamente:
//
//   - 60 usuarios  (15 por pais: AR, CO, ES, MX)
//   - 600 eventos (~10 por usuario, exactamente 10 para que el split 300/300
//                sea facil de explicar en clase)
//
// Por que ~10 eventos por usuario y no "exactamente 10":
//   - El feature doc dice "~10". Usamos exactamente 10 para que las cuentas
//     cierren (60 users * 10 = 600 eventos; 300/300 por shard cuando el split
//     es limpio). Si mas adelante el feature pide varianza, se cambia el seed.
//
// Datos DETERMINISTICOS:
//   - Pools hardcoded de ~20 nombres, 10 productos y 8 tipos de evento.
//   - LCG sembrado en 42 provee variabilidad intra-pool (que nombre para cada
//     user_id, que producto en cada purchase, etc).
//   - Misma corrida (mismo seed) -> mismos datos. Borrar y re-correr produce
//     exactamente los mismos 60 usuarios y 600 eventos.
//
// Idempotencia:
//   1. deleteMany en ambas colecciones -> estado limpio.
//   2. Para cada coleccion, verifica que los chunks esten splitteados en el
//      punto adecuado y repartidos entre 2 shards. Si no, los redistribuye.
//   3. insertMany de usuarios (1 sola op -> mongoDB rutea per-doc).
//   4. insertMany de eventos (1 sola op -> mongoDB rutea per-doc).
//
// Distribucion esperada (NATURAL, no manipulada):
//   - usuarios  por {pais:1}    split en "ES"     -> 30 AR+CO / 30 ES+MX
//   - eventos   por {user_id:1} split en "usr-ES" -> 300 user_ids<usr-ES / 300 >=usr-ES
//   La distribucion surge del split point de la sharding key. MongoDB decide
//   a que shard va cada doc; nosotros solo establecemos las boundaries.
//
// Por que redistribute chunks:
//   - Despues de step 04, los chunks de eventos estan en [MinKey,"seed-ES") y
//     ["seed-ES",MaxKey). Los user_ids legacy empezaban con "seed-". Los
//     nuevos empiezan con "usr-" (lex > "seed-"), entonces sin redistribucion
//     TODO iria al chunk alto (un solo shard) -> 0/600.
//   - Para usuarios la boundary preexistente en "ES" ya encaja con AR<CO<ES<MX,
//     asi que la mayoria de las veces ensureTwoWayWaySplitAt() detecta "ya esta"
//     y se ahorra el merge+split+move.
//
// Sharding key + split point:
//   - usuarios {pais:1}: split at {pais:"ES"}. Lex: AR<CO<ES<MX. 30/30.
//   - eventos  {user_id:1}: split at {user_id:"usr-ES"}. Lex: usr-AR-001<...<usr-CO-015<usr-ES<usr-ES-001<...<usr-MX-015. 300/300.
//     (Cuidado: "usr-ES" (sin sufijo) < "usr-ES-001" lexicograficamente, asi que
//     el split boundary incluye cualquier user_id exactamente "usr-ES", que no
//     existe en nuestro dataset, y a todos los usr-ES-XXX los manda al chunk
//     "alto". Coherente con lo que queremos.)
//
// GOTCHA MongoDB 7 al listar chunks:
//   - config.chunks ya no tiene campo `ns`; usa `uuid`. Hay que joinear con
//     config.collections para encontrar el UUID del namespace. Mismo patron
//     que 04-insert-distribution.js.

print("\n[seed] ========================================");
print("[seed]  Seed masivo para taller de sharding  ");
print("[seed] ========================================");

const perfil    = db.getSiblingDB("taller_perfiles");
const actividad = db.getSiblingDB("taller_actividad");
const configDb  = db.getSiblingDB("config");

// ============ POOLS DETERMINISTICOS ============

const NOMBRES = [
  "Ana Ramirez",      "Luis Fernandez",  "Sofia Castro",     "Mateo Diaz",      "Valentina Gomez",
  "Sebastian Lopez",  "Camila Mendez",  "Diego Morales",    "Isabella Nunez",  "Joaquin Ortega",
  "Martina Perez",    "Tomas Quiroga",  "Renata Romero",    "Santiago Silva",   "Florencia Torres",
  "Benjamin Vargas",  "Catalina Vega",  "Nicolas Yanez",    "Emilia Zapata",   "Lucas Beltran",
];

const PRODUCTOS = [
  { id: "prod-001", nombre: "Auriculares Bluetooth",   categoria: "tecnologia",       precio: 89.99  },
  { id: "prod-002", nombre: "Mochila Urbana",          categoria: "moda",             precio: 45.50  },
  { id: "prod-003", nombre: "Cafetera Espresso",       categoria: "hogar",            precio: 159.00 },
  { id: "prod-004", nombre: "Libro Clean Code",        categoria: "libros",           precio: 32.75  },
  { id: "prod-005", nombre: "Zapatillas Running",      categoria: "deportes",         precio: 75.00  },
  { id: "prod-006", nombre: "Camara Compacta",         categoria: "tecnologia",       precio: 220.00 },
  { id: "prod-007", nombre: "Set de Sartenes",         categoria: "hogar",            precio: 99.50  },
  { id: "prod-008", nombre: "Suscripcion Streaming",   categoria: "entretenimiento",  precio: 12.99  },
  { id: "prod-009", nombre: "Reloj Inteligente",       categoria: "tecnologia",       precio: 199.00 },
  { id: "prod-010", nombre: "Mate Artesanal",          categoria: "hogar",            precio: 28.00  },
];

const TIPOS_EVENTO = [
  "login", "purchase", "view_product", "add_to_cart",
  "review", "search",   "share",        "like",
];

const QUERIES_SEARCH = ["auriculares", "mochila", "cafetera", "zapatillas", "reloj"];
const CANALES_SHARE  = ["facebook", "twitter", "whatsapp", "email"];
const TEXTOS_REVIEW  = ["Excelente", "Bueno", "Regular", "Malo", "Pesimo"];
const DEVICES        = ["mobile", "desktop"];

const PAISES = ["AR", "CO", "ES", "MX"]; // Orden lex: AR < CO < ES < MX.
const USUARIOS_POR_PAIS  = 15;
const EVENTOS_POR_USUARIO = 10;

// Linear Congruential Generator (Numerical Recipes constants).
// Reproducible: mismo seed -> misma secuencia.
function makeRng(seed) {
  let s = (seed >>> 0);
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const rng = makeRng(42); // seed global.

// ============ HELPERS DE SHARDING ============

// En MongoDB 7, config.chunks no tiene campo `ns` (se reemplazo por `uuid`).
// Hay que buscar el UUID en config.collections primero.
function listChunksForNs(ns) {
  const meta = configDb.getCollection("collections").findOne({ _id: ns });
  if (!meta) return [];
  return configDb.getCollection("chunks").find({ uuid: meta.uuid }).toArray();
}

function listShardIds() {
  return configDb.getCollection("shards").find().toArray().map((s) => s._id);
}

function sortChunksByMin(chunks, key) {
  return [...chunks].sort((a, b) => {
    const aMin = a.min[key];
    const bMin = b.min[key];
    if (aMin === bMin) return 0;
    if (aMin === undefined || (typeof aMin === "object" && aMin !== null)) return -1;
    if (bMin === undefined || (typeof bMin === "object" && bMin !== null)) return  1;
    return aMin < bMin ? -1 : 1;
  });
}

// Garantiza que la coleccion tenga un chunk boundary en el splitValue indicado,
// con el chunk "alto" (min = splitValue) en `targetHighShard` y el chunk "bajo"
// en cualquier otro shard. Si ya esta asi, no-op.
//
// Por que esta estrategia:
//   - moveChunk en MongoDB 7 tiene problemas cuando el chunk tiene historial
//     de haber estado en el destino (caso tipico despues de ejecutar el seed
//     varias veces). El forward direction (shard01 -> shard02) es el que
//     funciona consistentemente.
//   - El setup inicial de setup-cluster.ps1 (step 04) pone los chunks de
//     eventos en [MinKey,"seed-ES") en shard02 y ["seed-ES",MaxKey) en shard01.
//   - Para nuestros user_ids ("usr-AR-001".."usr-MX-015"), el split optimo es
//     en "usr-ES". chunk_b en shard01 contiene el rango ["seed-ES",MaxKey),
//     asi que con un split ahi y moviendo el resultado "alto" a shard02,
//     evitamos mover chunk_a (que falla) y logramos la distribucion 300/300.
//   - Si el cluster esta limpio (recien inicializado), hay 1 solo chunk que
//     cubre todo. Lo spliteamos en "usr-ES" y movemos la mitad "alta".
function ensureSplitAtWithHighOnShard(ns, splitMiddle, targetHighShard) {
  const splitKey   = Object.keys(splitMiddle)[0];
  const splitValue = splitMiddle[splitKey];

  print(`\n[seed] ${ns}: ensuring split boundary en ${JSON.stringify(splitMiddle)} con chunk alto en ${targetHighShard}`);

  let chunks = listChunksForNs(ns);
  chunks = sortChunksByMin(chunks, splitKey);

  print(`  chunks actuales: ${chunks.length}`);
  chunks.forEach((c) => print(`    ${JSON.stringify(c.min)} -> ${JSON.stringify(c.max)} @ ${c.shard}`));

  // 1. Si ya hay un boundary en splitValue Y el chunk alto esta en targetHighShard,
  //    estamos listos. SKIP.
  const highChunk = chunks.find((c) => c.min[splitKey] === splitValue);
  if (highChunk && highChunk.shard === targetHighShard) {
    print(`  [OK] Split boundary en ${JSON.stringify(splitValue)} ya esta, con chunk alto en ${targetHighShard}. Skip.`);
    return;
  }

  // 2. Encontrar el chunk que contiene splitValue (puede ser el chunk unico
  //    que cubre todo si el cluster esta limpio).
  let containingChunk = null;
  for (const c of chunks) {
    const cMin = c.min[splitKey];
    const cMax = c.max[splitKey];
    // cMin es MinKey si es el primero (object); cMax es MaxKey si es el ultimo.
    const lowerOk = (typeof cMin === "object" && cMin !== null) || cMin < splitValue;
    const upperOk = (typeof cMax === "object" && cMax !== null) || splitValue < cMax;
    if (lowerOk && upperOk) {
      containingChunk = c;
      break;
    }
  }

  if (!containingChunk) {
    print(`  [WARN] splitValue ${JSON.stringify(splitValue)} no cae dentro de ningun chunk. No-op.`);
    return;
  }

  // 3. Split el chunk que contiene splitValue.
  print(`  Split en ${containingChunk.shard} (range actual ${JSON.stringify(containingChunk.min)} -> ${JSON.stringify(containingChunk.max)})`);
  const splitRes = db.adminCommand({ split: ns, middle: splitMiddle });
  if (!splitRes || splitRes.ok !== 1) {
    const msg = (splitRes && splitRes.errmsg) || JSON.stringify(splitRes);
    if (/chunk boundary/i.test(msg)) {
      print(`  Split point ya en boundary. OK.`);
    } else {
      print(`  [WARN] split fallo: ${msg}`);
    }
  } else {
    print(`  Split OK`);
  }
  chunks = sortChunksByMin(listChunksForNs(ns), splitKey);

  // 4. Si el chunk alto (min = splitValue) no esta en targetHighShard,
  //    moverlo. Usamos SIEMPRE el direction forward (cualquier shard ->
  //    targetHighShard) porque es el unico que no se traba con historiales.
  const highAfter = chunks.find((c) => c.min[splitKey] === splitValue);
  if (highAfter && highAfter.shard !== targetHighShard) {
    print(`  Move chunk alto (${JSON.stringify(highAfter.min)} -> ${JSON.stringify(highAfter.max)}) de ${highAfter.shard} a ${targetHighShard}`);
    // Find: cualquier doc que caiga en el chunk alto. Usamos un valor
    // sintetico ("usr-..."-style) que sabemos cae en [usr-ES, MaxKey).
    const findDoc = {};
    for (const [k, v] of Object.entries(highAfter.min)) {
      findDoc[k] = (typeof v === "object" && v !== null) ? "a" : (v + "-zzz");
    }
    const moveRes = db.adminCommand({
      moveChunk: ns,
      find: findDoc,
      to: targetHighShard,
      _secondaryThrottle: false,
      waitForDelete: false,
      maxTimeMS: 120000,  // Generoso: con 600 docs en el chunk el clonado puede tardar.
    });
    if (!moveRes || moveRes.ok !== 1) {
      print(`  [WARN] moveChunk fallo: ${JSON.stringify(moveRes)}`);
    } else {
      print(`  Move OK`);
    }
  } else if (highAfter && highAfter.shard === targetHighShard) {
    print(`  Chunk alto ya esta en ${targetHighShard}. Skip move.`);
  }

  chunks = sortChunksByMin(listChunksForNs(ns), splitKey);
  print(`  chunks finales:`);
  chunks.forEach((c) => print(`    ${JSON.stringify(c.min)} -> ${JSON.stringify(c.max)} @ ${c.shard}`));
}

// ============ LIMPIEZA ============

print("\n[seed] Paso 1/6: limpiando colecciones ...");
const userDel = perfil.usuarios.deleteMany({});
print(`  taller_perfiles.usuarios.deleteMany: ${userDel.deletedCount} docs borrados`);
const evtDel = actividad.eventos.deleteMany({});
print(`  taller_actividad.eventos.deleteMany:  ${evtDel.deletedCount} docs borrados`);

// ============ ASEGURAR DISTRIBUCION DE CHUNKS ============

print("\n[seed] Paso 2/6: asegurando distribucion de chunks ...");
// usuarios: split at {pais:"ES"}. AR+CO en shard01-rs (bajo), ES+MX en shard02-rs (alto).
// El split preexistente de step 04 ya encaja.
ensureSplitAtWithHighOnShard("taller_perfiles.usuarios", { pais: "ES" }, "shard02-rs");
// eventos: split at {user_id:"usr-ES"}. AR+CO en shard01-rs (bajo), ES+MX en shard02-rs (alto).
// Cambia respecto a step 04 ("seed-ES"), por lo que se redistribuye.
ensureSplitAtWithHighOnShard("taller_actividad.eventos", { user_id: "usr-ES" }, "shard02-rs");

// ============ HELPERS DE DATOS ============

function pad3(n) {
  return n < 10 ? "00" + n : (n < 100 ? "0" + n : "" + n);
}

// Picks an item from an array using the LCG.
function pickFrom(arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function buildPayload(tipo, pais) {
  const prod = pickFrom(PRODUCTOS);
  switch (tipo) {
    case "login":
      return {
        ip: `10.${Math.floor(rng() * 256)}.${Math.floor(rng() * 256)}.${Math.floor(rng() * 256)}`,
        device: pickFrom(DEVICES),
        pais_origen: pais,
      };
    case "purchase":
      return {
        producto_id: prod.id,
        nombre:      prod.nombre,
        categoria:   prod.categoria,
        monto:       prod.precio,
        cantidad:    1 + Math.floor(rng() * 3),
        moneda:      "USD",
      };
    case "view_product":
      return {
        producto_id: prod.id,
        nombre:      prod.nombre,
        categoria:   prod.categoria,
        tiempo_en_pagina_ms: 500 + Math.floor(rng() * 60000),
      };
    case "add_to_cart":
      return {
        producto_id: prod.id,
        nombre:      prod.nombre,
        precio:      prod.precio,
      };
    case "review":
      return {
        producto_id: prod.id,
        nombre:      prod.nombre,
        rating:      1 + Math.floor(rng() * 5),
        texto:       pickFrom(TEXTOS_REVIEW),
      };
    case "search":
      return {
        query:       pickFrom(QUERIES_SEARCH),
        resultados:  Math.floor(rng() * 200),
      };
    case "share":
      return {
        canal:       pickFrom(CANALES_SHARE),
        producto_id: prod.id,
      };
    case "like":
      return {
        target:   rng() < 0.5 ? "post" : "producto",
        target_id: prod.id,
      };
    default:
      return {};
  }
}

// ============ GENERAR USUARIOS ============

print("\n[seed] Paso 3/6: generando 60 usuarios (15 por pais) ...");

const baseRegistro = new Date("2025-09-01T00:00:00Z").getTime();
const usuarios = [];

for (let pi = 0; pi < PAISES.length; pi++) {
  const pais = PAISES[pi];
  for (let i = 1; i <= USUARIOS_POR_PAIS; i++) {
    const idx = pi * USUARIOS_POR_PAIS + (i - 1);
    const userId = `usr-${pais}-${pad3(i)}`;
    const nombre = NOMBRES[idx % NOMBRES.length];
    const firstName = nombre.split(" ")[0].toLowerCase();
    // fecha_registro: offset aleatorio (vía LCG) sobre los últimos 365 días.
    const fechaRegistro = new Date(baseRegistro - Math.floor(rng() * 365) * 86400000);
    usuarios.push({
      _id:            userId,
      nombre:         nombre,
      email:          `${firstName}.${userId.toLowerCase()}@${pais.toLowerCase()}.taller.dev`,
      pais:           pais,
      fecha_registro: fechaRegistro,
    });
  }
}

print(`  usuarios a insertar: ${usuarios.length} (= ${PAISES.length} paises x ${USUARIOS_POR_PAIS})`);

// ============ INSERTAR USUARIOS ============

print("\n[seed] Paso 4/6: insertMany de usuarios ...");
const userInsert = perfil.usuarios.insertMany(usuarios);
print(`  insertMany: insertedCount=${userInsert.insertedIds ? Object.keys(userInsert.insertedIds).length : 0}`);
const userInsertedN = userInsert.insertedIds ? Object.keys(userInsert.insertedIds).length : 0;
if (userInsertedN !== usuarios.length) {
  throw new Error(`insertMany de usuarios fallo: esperaba ${usuarios.length}, obtuvo ${userInsertedN}`);
}

// ============ GENERAR EVENTOS ============

print("\n[seed] Paso 5/6: generando eventos (${EVENTOS_POR_USUARIO} por usuario, total esperado ${usuarios.length * EVENTOS_POR_USUARIO}) ...".replace("${EVENTOS_POR_USUARIO}", EVENTOS_POR_USUARIO).replace("${usuarios.length * EVENTOS_POR_USUARIO}", usuarios.length * EVENTOS_POR_USUARIO));

const baseEvento = new Date("2025-09-15T00:00:00Z").getTime();
const eventos = [];

for (const u of usuarios) {
  for (let e = 0; e < EVENTOS_POR_USUARIO; e++) {
    const tipo = pickFrom(TIPOS_EVENTO);
    // timestamp: aleatorio (vía LCG) en los últimos 90 días, con jitter por evento.
    const offsetMs = (Math.floor(rng() * 90) * 86400000) + Math.floor(rng() * 86400000);
    const timestamp = new Date(baseEvento - offsetMs);
    eventos.push({
      _id:       ObjectId(),
      user_id:   u._id,
      tipo:      tipo,
      payload:   buildPayload(tipo, u.pais),
      timestamp: timestamp,
    });
  }
}

print(`  eventos a insertar: ${eventos.length} (= ${usuarios.length} usuarios x ${EVENTOS_POR_USUARIO})`);

// ============ INSERTAR EVENTOS ============

print("\n[seed] Paso 6/6: insertMany de eventos ...");
const evtInsert = actividad.eventos.insertMany(eventos);
print(`  insertMany: insertedCount=${evtInsert.insertedIds ? Object.keys(evtInsert.insertedIds).length : 0}`);
const evtInsertedN = evtInsert.insertedIds ? Object.keys(evtInsert.insertedIds).length : 0;
if (evtInsertedN !== eventos.length) {
  throw new Error(`insertMany de eventos fallo: esperaba ${eventos.length}, obtuvo ${evtInsertedN}`);
}

// ============ VERIFICACION ============

print("\n[seed] ========================================");
print("[seed]  Verificacion final");
print("[seed] ========================================");

print("\n[seed] Conteos por pais (taller_perfiles.usuarios):");
const porPais = perfil.usuarios.aggregate([
  { $group: { _id: "$pais", total: { $sum: 1 } } },
  { $sort: { _id: 1 } },
]).toArray();
porPais.forEach((row) => print(`  ${row._id}: ${row.total}`));

print("\n[seed] Tipos de evento (taller_actividad.eventos):");
const porTipo = actividad.eventos.aggregate([
  { $group: { _id: "$tipo", total: { $sum: 1 } } },
  { $sort: { _id: 1 } },
]).toArray();
porTipo.forEach((row) => print(`  ${row._id}: ${row.total}`));

print("\n[seed] Total documentos:");
print(`  taller_perfiles.usuarios:  ${perfil.usuarios.countDocuments()}`);
print(`  taller_actividad.eventos:   ${actividad.eventos.countDocuments()}`);

print("\n[seed] --- getShardDistribution(): taller_perfiles.usuarios ---");
perfil.usuarios.getShardDistribution();

print("\n[seed] --- getShardDistribution(): taller_actividad.eventos ---");
actividad.eventos.getShardDistribution();

print("\n[seed] Muestra de los primeros 3 usuarios de cada pais:");
for (const pais of PAISES) {
  const sample = perfil.usuarios.find({ pais: pais }).sort({ _id: 1 }).limit(3).toArray();
  print(`  ${pais}:`);
  sample.forEach((u) => print(`    ${JSON.stringify(u)}`));
}

print("\n[seed] ===== seed masivo COMPLETADO =====");