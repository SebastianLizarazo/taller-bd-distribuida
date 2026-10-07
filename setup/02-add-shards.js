// 02-add-shards.js
//
// Ejecutar DENTRO de `taller-bd-mongos` vía `docker exec -i taller-bd-mongos mongosh ...`.
// Acá ya estamos hablando con el router; `sh` y `db.adminCommand({listShards:1})`
// están disponibles.
//
// Decisión: listar los shards existentes ANTES de agregar (idempotencia). Si el
// usuario corre el setup dos veces, no rompe: detecta shard01-rs/shard02-rs y
// los deja como están.

print("\n[add-shards] Listando shards actuales ...");
const existingRes = db.adminCommand({ listShards: 1 });
const existing = (existingRes && existingRes.shards) || [];
const existingIds = existing.map((s) => s._id);
print(`[add-shards] Shards actuales: ${existingIds.length ? existingIds.join(", ") : "(ninguno)"}`);

function ensureShard(rsName, rsHost) {
  if (existingIds.includes(rsName)) {
    print(`[${rsName}] Ya está agregado al cluster. Skip.`);
    return;
  }
  print(`[${rsName}] Ejecutando sh.addShard("${rsName}/${rsHost}:27017") ...`);
  // sh.addShard devuelve un doc con ok / errmsg. Imprimimos para que el log sea útil.
  printjson({ addShard: rsName, host: `${rsHost}:27017` });
  const r = sh.addShard(`${rsName}/${rsHost}:27017`);
  if (!r || (r.ok !== undefined && r.ok !== 1)) {
    throw new Error(`Falló addShard de ${rsName}: ${(r && r.errmsg) || JSON.stringify(r)}`);
  }
  print(`[${rsName}] Agregado OK.`);
}

ensureShard("shard01-rs", "shard01a");
ensureShard("shard02-rs", "shard02a");

print("\n[add-shards] sh.status() final:");
sh.status();