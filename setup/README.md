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

> El setup inicial mete un **seed minimo** (4 usuarios, 4 eventos). Para
> tener volumen realista (60 usuarios + 600 eventos) que demuestre el sharding
> visualmente, corré aparte `.\setup\seed.ps1` (ver "Seed de datos" mas abajo).

## Qué queda armado

Al final del setup, el cluster tiene:

- **2 bases de datos** (sharing **vertical** — dominios separados):
  - `taller_perfiles` → colección `usuarios` (`{_id, nombre, email, pais, fecha_registro}`)
  - `taller_actividad` → colección `eventos` (`{_id, user_id, tipo, payload, timestamp}`)
- **2 colecciones shardeadas** (sharing **horizontal** — filas repartidas entre shards):
  - `taller_perfiles.usuarios` shardeada por `{pais: 1}` (rango)
  - `taller_actividad.eventos`  shardeada por `{user_id: 1}` (rango)
- **Seed minimo** (4 usuarios, 4 eventos) para que `getShardDistribution()`
  no muestre 0/0 apenas arrancamos. Después del split + move manual del
  paso 04, los 2 shards tienen chunks asignados con datos.

Para volumen realista que demuestre el sharding visualmente (30/30 entre
shards, no 2/2 magro), correr aparte `.\setup\seed.ps1` — ver seccion
siguiente.

## Seed de datos (volumen realista)

`setup-cluster.ps1` mete solo 4 usuarios + 4 eventos para arrancar rapido.
Para el taller queremos volumen que muestre el sharding **visualmente**:
60 usuarios (15 por pais) y ~600 eventos (10 por usuario).

```powershell
.\setup\seed.ps1
```

Que hace:

1. Verifica que `taller-bd-mongos` esta corriendo (si no, aborta con un
   mensaje claro apuntando a `setup-cluster.ps1`).
2. Pingea `mongos` para confirmar que responde.
3. Ejecuta `setup/05-seed.js` dentro del contenedor `mongos`. El script:
   - Borra todas las docs de `taller_perfiles.usuarios` y `taller_actividad.eventos`.
   - Verifica / redistribuye los chunks para que el split point encaje con
     los nuevos datos (`{pais: "ES"}` y `{user_id: "usr-ES"}`).
   - Inserta 60 usuarios con pools deterministicos de nombres, emails y
     fechas (15 por pais: AR/CO/ES/MX).
   - Inserta 600 eventos (10 por usuario, ObjectId generado, payloads
     contextual al `tipo`: `{login, purchase, view_product, add_to_cart,
     review, search, share, like}`).
   - Imprime `getShardDistribution()` y conteos por pais al terminar.

Que esperar al final:

- `taller_perfiles.usuarios`: **30 docs en shard01-rs** (AR+CO) + **30 docs
  en shard02-rs** (ES+MX). Distribucion 50/50 exacta cuando el split en
  `{pais: "ES"}` esta bien configurado.
- `taller_actividad.eventos`: **300 en shard01-rs** (user_ids `usr-AR-*` +
  `usr-CO-*`) + **300 en shard02-rs** (user_ids `usr-ES-*` + `usr-MX-*`).
- `aggregate([{$group:{_id:"$pais",total:{$sum:1}}}])`: 4 grupos, cada uno
  con `total: 15`.

El seed es **idempotente**: borra y regenera desde cero. Lo podes correr
muchas veces seguidas, siempre da el mismo dataset (pools hardcoded + LCG
sembrado en 42).

> **Por que `seed.ps1` es aparte y no parte de `setup-cluster.ps1`**: el
> setup inicial es para arrancar de cero (contenedores, replica sets,
> shards, sharding). El seed masivo es data de demo que se regenera sin
> tocar la infra. Mezclarlos obligaria a re-inicializar el cluster cada
> vez que se quiere resetear los datos, que no es lo que queremos.

### Sharding key elegida

Rango (no hashed) para que las queries targeted sean predecibles y didácticas:

| Colección | Rango dividido | Split point | Resultado |
|-----------|----------------|-------------|-----------|
| `usuarios` por `{pais: 1}`    | `[MinKey, "ES")` y `["ES", MaxKey)` | `{pais: "ES"}` | chunk1 = {AR, CO}, chunk2 = {ES, MX} |
| `eventos`  por `{user_id: 1}` | `[MinKey, "seed-ES")` y `["seed-ES", MaxKey)` despues de `setup-cluster.ps1`; o `[MinKey, "usr-ES")` y `["usr-ES", MaxKey)` despues de `seed.ps1` | `{user_id: "seed-ES"}` o `{user_id: "usr-ES"}` | chunk1 = {AR, CO}, chunk2 = {ES, MX} |

MongoDB **no** garantiza que un valor particular vaya a un shard específico
con cardinalidad baja (sin split manual, autosplit no dispara con 4 docs).
El split + `moveChunk` del script 04 es lo que hace visible la distribución
desde la primera corrida.

Despues de correr `.\setup\seed.ps1` el split point de eventos pasa a
`{user_id: "usr-ES"}` (los nuevos user_ids arrancan con `usr-` en lugar de
`seed-`). El script lo redistribuye de forma idempotente.

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

- `setup-cluster.ps1`: orquestador idempotente (13 pasos). Inicializa el
  cluster desde cero (contenedores, RS, shards, sharding, seed minimo).
- `seed.ps1`: corre el seed MASIVO (paso 6 del taller). Pensado para correr
  muchas veces sin re-inicializar el cluster. Ver seccion "Seed de datos".
- `01-init-replicasets.js`: dispara `replSetInitiate` en los 3 nodos.
- `02-add-shards.js`: agrega los 2 shards vía mongos.
- `03-enable-sharding.js`: `enableSharding` + `shardCollection` para `taller_perfiles.usuarios`
  (por `{pais: 1}`) y `taller_actividad.eventos` (por `{user_id: 1}`).
- `04-insert-distribution.js`: upsert de 4 usuarios + 4 eventos semilla y `split` +
  `moveChunk` manual para que ambos shards tengan datos visibles.
- `05-seed.js`: seed masivo (60 usuarios + 600 eventos). Borrar + insertar
  con pools deterministicos. Redistribuye chunks si hace falta.

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