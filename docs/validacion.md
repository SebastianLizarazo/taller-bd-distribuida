# Validación end-to-end del taller

Esta página es la **guía de validación** que el profesor puede usar para verificar que todo el taller está correctamente armado.

## Pre-requisitos verificados

- [x] Cluster MongoDB sharded con 2 shards healthy
- [x] DB `taller_perfiles` con collection `usuarios` shardeada por `{pais: 1}`
- [x] DB `taller_actividad` con collection `eventos` shardeada por `{user_id: 1}`
- [x] 60 usuarios seed (15 por país: AR, CO, ES, MX) repartidos 50/50
- [x] 600 eventos seed repartidos 50/50
- [x] Backend Express con 11 endpoints respondiendo
- [x] Frontend React con 5 rutas sirviendo

## Pasos de validación manual

### Paso 1 — Cluster up
```powershell
docker compose ps
# Esperado: 4 servicios "running (healthy)"
```

### Paso 2 — Sharding status
```powershell
docker exec taller-bd-mongos mongosh --port 27017 --quiet --eval "sh.status()"
# Esperado: 2 shards, 2 colecciones shardeadas
```

### Paso 3 — Distribución de usuarios
```powershell
docker exec taller-bd-mongos mongosh --port 27017 --quiet --eval "db.getSiblingDB('taller_perfiles').usuarios.getShardDistribution()"
# Esperado: shard01-rs y shard02-rs con datos
```

### Paso 4 — Backend responde
```powershell
(Invoke-WebRequest "http://localhost:3001/health").Content
# Esperado: {"ok":true,"version":"7.0.43","shards":2,...}
```

### Paso 5 — Frontend sirve
```
http://127.0.0.1:5173
# Esperado: página "Sharing horizontal + vertical con MongoDB"
```

### Paso 6 — Sharing horizontal visible
- Click en "Dashboard de shards" → ver 2 shards con badges primary.
- Ver gráfico de barras con AR/CO en shard01 (amarillo) y ES/MX en shard02 (azul).

### Paso 7 — Sharing vertical visible
- Click en "Listar usuarios" → click en `usr-AR-001` (o similar).
- Ver dos secciones: "Datos base" (vienen de `taller_perfiles`) y "Datos extendidos" (vienen de `taller_actividad`).
- Verificar que los eventos listados tienen el mismo `user_id` que el usuario del perfil.

### Paso 8 — Demostración en vivo del routing
- Click en "Crear usuario", crear un `AR` → respuesta con `shard_destino: shard01-rs`.
- Crear un `MX` → respuesta con `shard_destino: shard02-rs`.

## Pruebas automatizadas (opcional)

El taller no incluye tests automatizados (es un taller educativo, no producción). Sin embargo, los endpoints admin son las "pruebas" que el profesor puede correr.

## Limitaciones conocidas

- Single-node replica sets (sin failover real). Producción necesita RS de 3 nodos mínimo.
- Sin autenticación ni TLS. Solo para desarrollo local.
- El split por `user_id` con prefijos `usr-{PAIS}` hace que perfil y eventos caigan en el mismo shard por diseño. Para mostrar el caso "perfil y eventos en shards distintos" habría que usar ObjectIds aleatorios. Documentado en la UI.
- `cleanupOrphaned` no se usa (los seeds están diseñados para no generar huérfanos).

## Tiempo total de setup en una máquina limpia

| Paso | Tiempo |
|---|---|
| `docker compose up -d` + healthcheck | ~60s |
| `setup-cluster.ps1` (init RS + enable sharding) | ~30s |
| `seed.ps1` (60 usuarios + 600 eventos) | ~5s |
| `npm install` en backend y frontend | ~30s |
| **Total** | **~2 min** |
