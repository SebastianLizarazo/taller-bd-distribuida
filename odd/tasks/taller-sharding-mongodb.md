# Taller: Sharding Horizontal + Vertical con MongoDB

## Goal

Construir una app funcional que demuestre **sharing horizontal** (filas repartidas entre shards por sharding key) y **sharing vertical** (columnas/datos repartidos entre bases de datos), usando un **MongoDB sharded cluster** como motor moderno. La app debe permitir al profesor verificar visualmente dónde vive cada dato y por qué.

## Problem

El profesor de "Tendencias modernas de bases de datos" asignó un taller donde hay que diseñar, implementar, demostrar y validar ambos tipos de sharding en un motor moderno. Lo entregable es:

1. Sharding horizontal **cl** demonstrado: misma tabla `usuarios` con documentos que caen en distintos shards según su `pais`.
2. Sharding vertical **cl** demonstrado: datos "base" (perfil) en una DB y datos "extendidos" (actividad/eventos) en otra DB, cruzados por `user_id`.
3. Una app funcional que pruebe ambos casos end-to-end.
4. Material de validación: `sh.status()`, queries targeted vs scatter-gather, distribución visible.

## Why

- Es la entrega de la materia; necesita ser ejecutable y verificable por el profesor.
- MongoDB sharded cluster es el ejemplo didáctico estándar de sharding horizontal (config server + shards + mongos) y permite mostrar vertical partitioning con el patrón "DBs separadas para dominios diferentes, cruzadas por user_id".
- Tu historial muestra preferencia por Node + React + Vite con README ejecutable en PowerShell — reutilizamos el patrón de tu taller TiDB para mantener consistencia.

## Stack

- **DB**: MongoDB 7.x sharded cluster (1 config RS + 2 shard RS de 1 nodo + 1 mongos).
- **Orquestación local**: Docker Compose.
- **Backend**: Node.js + Express + driver nativo `mongodb` (NO Mongoose, para que el código operativo y vea explícitamente a qué shard apunta cada query).
- **Frontend**: React 18 + Vite + React Router 6 + axios + Context API (mismo stack que tu taller TiDB).
- **Setup scripts**: Node scripts ejecutables desde PowerShell.

## Scope

**In scope**:
- Cluster MongoDB completo con shards funcionando, todo dockerizado.
- 2 bases de datos (`taller_perfiles`, `taller_actividad`) que ilustran el sharing vertical.
- Sharding horizontal dentro de cada base por una sharding key significativa.
- API REST con endpoints CRUD + endpoints de administración/observabilidad.
- UI mínima que demuestre cada caso.
- README ejecutable en Windows + scripts de setup.
- Comandos de validación (`sh.status()`, conteo por shard, where-is).

**Out of scope**:
- Autenticación de usuarios.
- Replica sets de más de 1 nodo (suficiente 1 para taller; producción necesita 3).
- TLS, autenticación interna del cluster.
- Sharding key por hashed vs ranged (usamos ranged por simplicidad pedagógica).
- Resharding, chunk splitting automático (lo dejamos activo pero no lo demostramos).

## Constraints

- Windows + PowerShell 5.1 como entorno de referencia (consistente con tu historial).
- Docker debe estar instalado en la máquina del profesor; README explica verificación.
- Sin pago: ninguna dependencia cloud.
- Las sharding keys elegidas deben hacer que un query con la clave sea *targeted* (va a 1 solo shard) — eso es la prueba de que el sharding funciona.

## Architecture

```
Cliente (React)
     │  HTTP
     ▼
Backend (Express :3001)
     │  MongoDB driver
     ▼
   mongos :27017  ────── config servers (rs1) ── metadata
     │
     ├── shard01 (rs shard01) ← usuarios pais∈{AR,CO}, eventos user_id%2==0
     └── shard02 (rs shard02) ← usuarios pais∈{MX,ES}, eventos user_id%2!=0
```

**Sharing horizontal** (filas):
- `taller_perfiles.usuarios` shardeada por `pais` → documentos con `pais: "AR"` caen en shard01, `pais: "MX"` en shard02.
- `taller_actividad.eventos` shardeada por `user_id` → hash/rango particionado entre ambos shards.

**Sharing vertical** (columnas / dominios):
- DB `taller_perfiles`: `usuarios` con `{_id, nombre, email, pais, fecha_registro}` (atributos base).
- DB `taller_actividad`: `eventos` con `{_id, user_id, tipo, payload, timestamp}` (atributos verticales / extendidos).
- Unión lógica por `user_id`. Un GET del "perfil completo" hace lookup cruzando DBs.

## Tasks

### T00 — Inicializar repo git y crear branch feature
- `git init`, primer commit vacío, branch `feature/sharding-mongodb`.
- Crear `.gitignore` (node_modules, .env, dist).
- **Acceptance**: `git status` limpio, branch actual = `feature/sharding-mongodb`.

### T01 — Setup del cluster MongoDB sharded
- `docker-compose.yml` con servicios: `config01`, `shard01a`, `shard02a`, `mongos`, `backend`, `frontend`.
- `setup/01-init-replicasets.js`: inicializa config RS y shard RS vía `rs.initiate()`.
- `setup/02-add-shards.js`: conecta desde mongos, agrega los 2 shards al cluster.
- `setup/setup-cluster.ps1`: ejecuta todo desde PowerShell.
- **Acceptance**: `docker compose ps` muestra 5 servicios healthy; `mongosh --host mongos` responde.

### T02 — Inicializar sharding en las 2 bases (vertical + horizontal)
- `setup/03-enable-sharding.js`: `sh.enableSharding("taller_perfiles")`, `sh.shardCollection("taller_perfiles.usuarios", { pais: 1 })`; idem `taller_actividad.eventos` con `{ user_id: 1 }`.
- `setup/04-insert-countries.js`: inserta 1 doc "país" inicial en cada shard para forzar distribución.
- **Acceptance**: `sh.status()` muestra las 2 colecciones shardeadas con sus respectivos shards.

### T03 — Seed data multi-país
- `setup/05-seed.js`: inserta 60 usuarios (15 por país: AR, MX, CO, ES) y ~10 eventos por usuario.
- Después del seed, los usuarios deben estar repartidos: AR+CO en shard01, MX+ES en shard02.
- **Acceptance**: `db.usuarios.getDistribution()` (helper) devuelve 30/30 entre shards; UI muestra el split.

### T04 — Backend: estructura + conexión al cluster
- `backend/package.json`, `backend/src/index.js` (Express + cors), `backend/src/db.js` (cliente MongoDB al `mongos`).
- Logger mínimo que imprima a qué shard está conectada cada operación cuando aplica.
- `backend/.env.example` con `MONGOS_URI=mongodb://mongos:27017`.
- **Acceptance**: `GET /health` retorna `{ ok: true, version }`; logs muestran conexión exitosa.

### T05 — Backend: endpoints CRUD (usuarios + eventos)
- `POST /api/usuarios` (body: `{nombre, email, pais}`), `GET /api/usuarios?pais=AR` (targeted), `GET /api/usuarios/:id`, `PUT /api/usuarios/:id`.
- `POST /api/usuarios/:id/eventos`, `GET /api/usuarios/:id/eventos`.
- Cada handler documenta si la query es *targeted* o *scatter-gather* en un comment.
- **Acceptance**: tests manuales con curl o Postman; logs muestran qué shard atiende cada query.

### T06 — Backend: endpoints admin / observabilidad
- `GET /api/admin/shard-status` → `sh.status()`.
- `GET /api/admin/distribucion` → count de usuarios por shard vía `$lookup` o aggregate con `$merge`/`$out`.
- `GET /api/admin/donde-esta/:user_id` → en qué shard vive el perfil y cada evento del usuario (para demostrar sharing vertical).
- `GET /api/admin/balance` → confirma que la sharding key reparte bien.
- **Acceptance**: cada endpoint devuelve JSON claro con el shard exacto; curl examples en README.

### T07 — Frontend: setup + estructura
- `frontend/package.json`, Vite config, `src/main.jsx`, `src/App.jsx` con router.
- Páginas: `Home`, `CrearUsuario`, `ListarUsuarios`, `PerfilCompleto`, `DashboardShards`.
- Componentes compartidos: `Layout`, `ShardBadge`, `UserCard`.
- `frontend/.env.example` con `VITE_API_URL=http://localhost:3001`.
- **Acceptance**: `npm run dev` arranca; rutas navegan; layout renderiza.

### T08 — Frontend: vistas funcionales
- `CrearUsuario`: form que postea y muestra respuesta con shard destino.
- `ListarUsuarios`: tabla con filtros por país + badge del shard.
- `PerfilCompleto`: muestra perfil (vertical/perfiles) + eventos (vertical/actividad) cruzada por user_id — PRUEBA VISUAL DEL SHARING VERTICAL.
- `DashboardShards`: panel con `shard-status`, distribución (gráfico de barras simple), y balance — PRUEBA VISUAL DEL SHARING HORIZONTAL.
- **Acceptance**: cada vista carga datos reales del backend y muestra información del shard.

### T09 — README ejecutable + scripts de validación
- README raíz: requisitos, `docker compose up -d`, `.\setup\setup-cluster.ps1`, `.\setup\seed.ps1`, `npm install` en backend y frontend, `npm run dev` para cada uno.
- Sección "Cómo el profesor valida el sharding":
  1. Abrir `DashboardShards` → ver 2 shards activos y ~30 usuarios cada uno.
  2. Crear un usuario AR y un usuario MX → ver que la respuesta indica shards distintos.
  3. Buscar un usuario → abrir `PerfilCompleto` → ver que los eventos vienen de otra DB.
  4. Comandos `mongosh` opcionales para `sh.status()` y `db.usuarios.getShardDistribution()`.
- **Acceptance**: profesor corre los pasos del README y todo funciona.

### T10 — Validación end-to-end + commit final
- Smoke test manual completo (checklist en `docs/validacion.md`).
- Capturas/descripción de lo que ve el profesor en cada vista.
- Commit final con todo integrado.
- **Acceptance**: checklist de validación marcado, commit limpio.

## Acceptance criteria (globales)

- [x] Cluster MongoDB sharded cluster arranca con `docker compose up -d`.
- [x] `sh.status()` desde `mongos` muestra 2 shards.
- [x] `taller_perfiles.usuarios` está shardeada por `pais`.
- [x] `taller_actividad.eventos` está shardeada por `user_id`.
- [x] Backend expone endpoints CRUD + admin.
- [x] Frontend React + Vite muestra las 4 vistas clave.
- [x] README ejecutable paso a paso para Windows.
- [x] Una persona (el profesor) puede clonar/correr y ver el sharding funcionando.

## Checks aplicables por task

- **T01–T03**: bash para `docker compose ps`, `mongosh` para `sh.status()`, conteo por shard.
- **T04–T06**: smoke test con curl al backend; logs visibles.
- **T07–T08**: `npm run dev` levanta sin error; navegador muestra cada vista.
- **T09–T10**: lectura crítica + commit.

## Verification evidence

Se va completando el check tras **T04 (commit)**, el check tras **T07 (commit), y el check tras **T10 (commit)**. Cada task cierra con un commit concreto anotado en este documento.

## Next step inmediato

Empezar por T01 — setup del cluster. Una vez que el cluster arranca y `sh.status()` devuelve 2 shards, avanzamos a T02.