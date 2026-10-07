# Setup del cluster MongoDB sharded

Levanta el cluster mínimo para el taller:

- 1 config server (`config01`, replica set `config-rs`)
- 2 shards (`shard01a`, `shard02a`, replica sets `shard01-rs` / `shard02-rs`)
- 1 router (`mongos`, expone `27017` al host)

> El **único** puerto expuesto al host es el **27017 del mongos**. Los shards y
> el config server sólo se ven entre sí en la red interna de docker.

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
7. Imprime `sh.status()` final.

**Es idempotente**: si lo corrés dos veces seguidas, detecta lo que ya está
iniciado y no rompe.

## Verificación manual

Una vez que el script termine:

```powershell
mongosh --host localhost:27017 --eval "sh.status()"
```

Deberías ver 2 shards listados (`shard01-rs` y `shard02-rs`).

## Apagar / limpiar

Para detener los contenedores y borrar los volúmenes (reseteo total):

```powershell
docker compose down -v
```

Sólo detener (sin borrar datos):

```powershell
docker compose down
```

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

## Archivos

- `setup-cluster.ps1`: orquestador.
- `01-init-replicasets.js`: dispara `replSetInitiate` en los 3 nodos.
- `02-add-shards.js`: agrega los 2 shards vía mongos.

Los nombres de contenedor llevan el prefijo `taller-bd-` para no chocar con
otros talleres que puedan estar corriendo en la misma máquina.