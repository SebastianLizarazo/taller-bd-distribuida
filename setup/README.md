# Setup del cluster MongoDB sharded

Levanta el cluster mínimo para el taller:

- 1 config server (`config01`, replica set `config-rs`)
- 2 shards (`shard01a`, `shard02a`, replica sets `shard01-rs` / `shard02-rs`)
- 1 router (`mongos`, expone `27017` al host)

> El **único** puerto expuesto al host es el **27017 del mongos**. Los shards y
> el config server sólo se ven entre sí en la red interna de docker.

> **Aviso de producción**: cada shard corre con UN SOLO nodo (`shard01a` /
> `shard02a`). Las elecciones de primary funcionan pero **NO hay failover real**.
> Si se cae el contenedor del shard, ese shard queda inaccesible hasta que
> vuelva. Para producción, replica sets de ≥3 nodos. Para la entrega del
> taller, alcanza.

## Requisitos

- **Windows 10/11** con PowerShell 5.1.
- **Docker Desktop** abierto y funcional (`docker info` debe responder).

## Cómo correr

Desde la raíz del repo:

```powershell
.\setup\setup-cluster.ps1
```

El script:

1. Detecta si tenés `docker compose` (v2, recomendado) o `docker-compose` (v1).
2. Levanta los 4 contenedores (`docker compose up -d`).
3. Espera a que los healthchecks reporten `healthy`.
4. Inicializa los 3 replica sets (`setup/01-init-replicasets.js`).
5. Espera a que cada RS tenga un primary (`myState === 1`).
6. Agrega los 2 shards al cluster vía mongos (`setup/02-add-shards.js`).
7. **Habilita sharding** en `taller_perfiles` y `taller_actividad` y shardea las
   colecciones (`setup/03-enable-sharding.js`).
8. **Inserta seed data** mínimo (4 usuarios + 4 eventos) y fuerza la
   distribución entre los 2 shards con `split` + `moveChunk`
   (`setup/04-insert-distribution.js`).
9. Imprime `getShardDistribution()` final.

**Es idempotente**: si lo corrés dos veces seguidas, detecta lo que ya está
iniciado y no rompe. Los `enableSharding` y `shardCollection` chequean
`config.collections` antes de invocarse para no duplicar estado.

## Qué queda armado

Al final del setup, el cluster tiene:

- **2 bases de datos** (sharing **vertical** — dominios separados):
  - `taller_perfiles` → colección `usuarios` (`{_id, nombre, email, pais, fecha_registro}`)
  - `taller_actividad` → colección `eventos` (`{_id, user_id, tipo, payload, timestamp}`)
- **2 colecciones shardeadas** (sharing **horizontal** — filas repartidas entre shards):
  - `taller_perfiles.usuarios` shardeada por `{pais: 1}` (rango)
  - `taller_actividad.eventos`  shardeada por `{user_id: 1}` (rango)
- **Seed data inicial**: 4 usuarios (uno por país: AR, MX, CO, ES) y 4 eventos
  (uno por usuario). Después del split + move manual, los 2 shards tienen
  chunks asignados con datos.

### Sharding key elegida

Rango (no hashed) para que las queries targeted sean predecibles y didácticas:

| Colección | Rango dividido | Split point | Resultado |
|-----------|----------------|-------------|-----------|
| `usuarios` por `{pais: 1}`    | `[MinKey, "ES")` y `["ES", MaxKey)` | `{pais: "ES"}` | chunk1 = {AR, CO}, chunk2 = {ES, MX} |
| `eventos`  por `{user_id: 1}` | `[MinKey, "seed-ES")` y `["seed-ES", MaxKey)` | `{user_id: "seed-ES"}` | chunk1 = {AR, CO}, chunk2 = {ES, MX} |

MongoDB **no** garantiza que un valor particular vaya a un shard específico
con cardinalidad baja (sin split manual, autosplit no dispara con 4 docs).
El split + `moveChunk` del script 04 es lo que hace visible la distribución
desde la primera corrida.

## Verificación manual

Una vez que el script termine, podés inspeccionar el estado desde el host:

```powershell
# Estado del cluster
mongosh --host localhost:27017 --eval "sh.status()"

# Cuántos docs hay por shard en cada colección
docker exec -i taller-bd-mongos mongosh --port 27017 --eval "db.getSiblingDB('taller_perfiles').usuarios.getShardDistribution()"
docker exec -i taller-bd-mongos mongosh --port 27017 --eval "db.getSiblingDB('taller_actividad').eventos.getShardDistribution()"

# En qué shard vive un doc puntual (targeted query)
mongosh --host localhost:27017 --eval "db.getSiblingDB('taller_perfiles').usuarios.find({pais: 'AR'}).explain('executionStats').queryPlanner.winningPlan.shards"
```

Deberías ver 2 shards listados (`shard01-rs` y `shard02-rs`) en `sh.status()`,
y los `getShardDistribution()` deberían mostrar datos repartidos entre ambos.

## Apagar / limpiar

Para detener los contenedores y borrar los volúmenes (reseteo total):

```powershell
docker compose down -v
```

Sólo detener (sin borrar datos):

```powershell
docker compose down
```

## Archivos de este setup

- `setup-cluster.ps1`: orquestador idempotente (13 pasos).
- `01-init-replicasets.js`: dispara `replSetInitiate` en los 3 nodos.
- `02-add-shards.js`: agrega los 2 shards vía mongos.
- `03-enable-sharding.js`: `enableSharding` + `shardCollection` para `taller_perfiles.usuarios`
  (por `{pais: 1}`) y `taller_actividad.eventos` (por `{user_id: 1}`).
- `04-insert-distribution.js`: upsert de 4 usuarios + 4 eventos semilla y `split` +
  `moveChunk` manual para que ambos shards tengan datos visibles.

Los nombres de contenedor llevan el prefijo `taller-bd-` para no chocar con
otros talleres que puedan estar corriendo en la misma máquina.

## Troubleshooting

- **"docker no responde"** → abrí Docker Desktop.
- **Contenedor queda en `starting` mucho tiempo** → puede que la primera
  inicialización de `mongod` esté tardando. El orquestador espera hasta 180s.
  Si excede, revisá `docker logs taller-bd-config01` (o el shard que falle).
- **"no llega a primary"** → el RS de un solo nodo tarda ~10-30s en elegir
  primary la primera vez. Si sigue fallando, `docker compose down -v` y volver
  a correr.
- **sh.status() muestra 0 shards** → casi siempre es que `02-add-shards.js`
  falló. Re-corré el script; es idempotente.
- **shardCollection tira "already sharded"** → ya estaba aplicado de una corrida
  anterior; el script 03 lo skippea automáticamente vía `config.collections`.
- **getShardDistribution muestra un solo shard** → corrió `04-insert-distribution.js`
  pero el split/move falló (típicamente porque ya había chunks en ambos shards de
  una corrida previa). Re-ejecutá el script completo; es idempotente.