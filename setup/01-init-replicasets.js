// 01-init-replicasets.js
//
// Ejecutar DENTRO de cualquier mongod del cluster (en nuestro caso, lo
// ejecutamos dentro de `taller-bd-config01` vía `docker exec -i ... mongosh ...`).
//
// El script abre TRES conexiones (una por replica set) y dispara `replSetInitiate`
// en cada una. La elección de primary ocurre de forma asíncrona; el orquestador
// PowerShell (`setup-cluster.ps1`) es el que hace el wait de `myState === 1`.
//
// Decisión: un solo archivo en lugar de tres (01-config / 02-shard01 / 03-shard02)
// porque la única acción por RS es `replSetInitiate` (idempotente gracias al check
// previo de `replSetGetStatus`). Tres archivos separados serían más pasos para
// el orquestador sin aportar claridad. El bloque por RS está claramente
// delimitado y la función `ensureRS` encapsula la idempotencia.

function ensureRS(rsName, hostName) {
  print(`\n[${rsName}] Conectando a mongodb://${hostName}:27017/?directConnection=true ...`);
  const conn = new Mongo(`mongodb://${hostName}:27017/?directConnection=true`);
  const admin = conn.getDB("admin");

  // 1. ¿Ya está iniciado? Si sí, skip.
  try {
    const status = admin.adminCommand({ replSetGetStatus: 1 });
    if (status.ok === 1 && status.set === rsName) {
      print(`[${rsName}] Ya iniciado (set=${status.set}, myState=${status.myState}). Skip.`);
      return;
    }
    print(`[${rsName}] replSetGetStatus ok pero set mismatch (${status.set}). Re-iniciando...`);
  } catch (e) {
    // Esperado en la primera corrida: el RS aún no está iniciado.
    print(`[${rsName}] Aún no iniciado (${e.codeName || e.message}). Iniciando...`);
  }

  // 2. Iniciar el RS con un único miembro (suficiente para el taller).
  const result = admin.adminCommand({
    replSetInitiate: {
      _id: rsName,
      members: [{ _id: 0, host: `${hostName}:27017` }],
    },
  });

  printjson({ rs: rsName, initiate_result: result });

  if (!result.ok) {
    throw new Error(`Falló replSetInitiate de ${rsName}: ${result.errmsg || JSON.stringify(result)}`);
  }
  print(`[${rsName}] Initiate disparado. La elección de primary sucede en background.`);
}

// IMPORTANTE: docker DNS resuelve los nombres de contenedor dentro de la red del
// proyecto. Por eso usamos "config01", "shard01a", "shard02a" (no localhost).
ensureRS("config-rs",  "config01");
ensureRS("shard01-rs", "shard01a");
ensureRS("shard02-rs", "shard02a");

print("\n[init] Los 3 replica sets dispararon initiate. El orquestador .ps1 esperará myState=1.");