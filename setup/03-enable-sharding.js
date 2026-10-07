// 03-enable-sharding.js
//
// Ejecutar DENTRO de `taller-bd-mongos` via `docker exec -i taller-bd-mongos mongosh ...`.
//
// Crea 2 bases (taller_perfiles, taller_actividad) que ilustran el sharing VERTICAL,
// y shardea cada coleccion principal por una clave distinta para ilustrar el sharing
// HORIZONTAL.
//
//   vertical  ->  dominios separados en DBs distintas (perfiles vs actividad)
//   horizontal -> cada coleccion shardeada por una clave que reparte las filas
//
// IMPORTANTE: cada shard es un replica set de UN SOLO nodo. Las elecciones de primary
// funcionan pero NO hay failover real: si el contenedor del shard se cae, ese shard
// queda inaccesible hasta que vuelva.
//
// Decisiones tecnicas:
//   - Sharding por RANGO (no hashed) sobre { pais: 1 } y { user_id: 1 } para que las
//     queries targeted por la clave sean educativas y obvias. Hashed sharding hace
//     imposible predecir a que shard cae un valor, lo cual quita valor didactico.
//   - El split entre valores se hace manual en 04-insert-distribution.js; este script
//     solo habilita y declara las claves.
//
// GOTCHA sobre `partitioned` en MongoDB 7:
//   - En MongoDB 7 `listDatabases` puede incluir el campo `partitioned`, pero SOLO
//     se setea a `true` para el feature NUEVO de "Database Partitioning" (shardDatabase).
//     Las DBs con sharding de coleccion LEGACY (sh.shardCollection) muestran
//     `partitioned: undefined` o `false` en listDatabases, pero igual tienen sus
//     colecciones shardeadas. Por eso no usamos `partitioned` como check de idempotencia.
//   - enableSharding() es idempotente: si la DB ya estaba marcada para sharding,
//     devuelve {ok:1} sin error. Lo llamamos siempre.
//
// Idempotencia:
//   - createIndex sobre la sharding key es idempotente (MongoDB lo ignora si ya existe
//     con el mismo spec).
//   - enableSharding sobre una DB ya habilitada es no-op (devuelve ok:1).
//   - shardCollection sobre una coleccion ya shardeada TIRA ERROR; por eso chequeamos
//     config.collections antes de invocarlo.

print("\n[enable-sharding] Listando DBs actuales ...");
const dbsBefore = (db.adminCommand({ listDatabases: 1 }).databases || []).map((d) => d.name);
print(`[enable-sharding] DBs: ${dbsBefore.join(", ") || "(solo admin/config)"}`);

function collectionIsSharded(dbName, collName) {
  const configDb = db.getSiblingDB("config");
  const entry = configDb.getCollection("collections").findOne({
    _id: `${dbName}.${collName}`,
  });
  // Si la coleccion fue dropeada, queda una entry residual con dropped:true.
  return Boolean(entry) && entry.dropped !== true;
}

function ensureShardedCollection(dbName, collName, shardKey) {
  print(`\n[${dbName}.${collName}] Preparando sharding por ${JSON.stringify(shardKey)}`);

  // 1. Crear el indice sobre la sharding key. Es REQUISITO de MongoDB antes de
  //    shardear: si no existe, shardCollection tira "please create an unique index".
  //    Tambien crea la coleccion (MongoDB es lazy con las DBs).
  print(`[${dbName}.${collName}] createIndex(${JSON.stringify(shardKey)}) ...`);
  const idxName = db.getSiblingDB(dbName)[collName].createIndex(shardKey);
  print(`[${dbName}.${collName}] Indice creado: '${idxName}'`);

  // 2. enableSharding sobre la DB. Idempotente: si ya estaba habilitada, devuelve
  //    {ok:1} sin error. Lo llamamos siempre (el skip-log lo detecta config.collections
  //    en el paso siguiente).
  print(`[${dbName}.${collName}] enableSharding('${dbName}') ...`);
  const esRes = sh.enableSharding(dbName);
  if (!esRes || esRes.ok !== 1) {
    throw new Error(`enableSharding('${dbName}') fallo: ${JSON.stringify(esRes)}`);
  }
  print(`[${dbName}.${collName}] enableSharding OK`);

  // 3. shardCollection. ESTE es el paso que rompe si se re-corre sin chequeo:
  //    devuelve error "shard collection already sharded" si la coleccion ya esta
  //    shardeada. Por eso el guard es OBLIGATORIO.
  if (collectionIsSharded(dbName, collName)) {
    print(`[${dbName}.${collName}] shardCollection() ya estaba aplicado. Skip.`);
  } else {
    print(`[${dbName}.${collName}] shardCollection('${dbName}.${collName}', ${JSON.stringify(shardKey)}) ...`);
    const r = sh.shardCollection(`${dbName}.${collName}`, shardKey);
    printjson({ ns: `${dbName}.${collName}`, shardCollection: r });
    if (!r || r.ok !== 1) {
      throw new Error(`shardCollection() fallo: ${JSON.stringify(r)}`);
    }
  }
}

// Sharing vertical: 2 DBs separadas.
// Sharing horizontal: cada coleccion shardeada por una clave que reparte filas.
ensureShardedCollection("taller_perfiles",  "usuarios", { pais:    1 });
ensureShardedCollection("taller_actividad", "eventos",  { user_id: 1 });

print("\n[enable-sharding] Verificacion (colecciones shardeadas):");
const configColls = db.getSiblingDB("config").getCollection("collections").find({}).toArray();
for (const c of configColls) {
  if (c._id.startsWith("taller_") && c.dropped !== true) {
    print(`  ${c._id}: shardKey=${JSON.stringify(c.key)}`);
  }
}

print("\n[enable-sharding] sh.status() (output completo para orientacion):");
sh.status();