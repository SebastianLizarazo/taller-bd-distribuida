# Taller: Sharding Horizontal + Vertical con MongoDB

App funcional que demuestra **sharing horizontal** (filas repartidas entre shards por sharding key) y **sharing vertical** (datos base en una DB, datos extendidos en otra DB, cruzados por `user_id`) usando un **MongoDB sharded cluster** corriendo en Docker.

## Integrantes
- Edwar Esteban Fonseca Jiménez 
- David Sebastián Quijano Obando 
- Sebastián David Lizarazo Duarte 
- Jonathan David Romero Bayona 
- Alejandro Huérfano Benítez


---

## Requisitos

- **Docker** (Docker Desktop o Docker Engine) con `docker compose` v2+
- **Node.js 18+** (probado con Node 24, npm 11)
- **PowerShell 5.1** (Windows) o bash (Mac/Linux)
- ~2 GB de RAM libres para los 4 contenedores MongoDB

Verificación rápida:

```powershell
docker --version
docker compose version
node --version
```

---

## Cómo probarlo (Windows + PowerShell)

Primero clona el repo y entra a su raíz:

```powershell
git clone https://github.com/SebastianLizarazo/taller-bd-distribuida.git
cd taller-bd-distribuida
```

A partir de aquí necesitas **2 terminales PowerShell abiertas** en la raíz del repo. La primera se usa para el setup inicial y después se queda corriendo el backend; la segunda se queda corriendo el frontend. No las cierres mientras uses la app.

### Terminal 1 — Setup del cluster y backend

```powershell
# 1. Levantar los 4 contenedores del sharded cluster (config RS + 2 shards + mongos)
docker compose up -d
Start-Sleep -Seconds 10   # esperar healthchecks

# 2. Inicializar replica sets + agregar shards al cluster
.\setup\setup-cluster.ps1

# 3. Cargar 60 usuarios y 600 eventos (opcional, la app funciona sin esto)
.\setup\seed.ps1

# 4. Backend (esta terminal QUEDA CORRIENDO el proceso de Node — no la cierres)
cd backend
Copy-Item .env.example .env
npm install
npm start                # http://localhost:3001
```

### Terminal 2 — Frontend

```powershell
# 5. Frontend (esta terminal QUEDA CORRIENDO el dev server de Vite — no la cierres)
cd frontend
Copy-Item .env.example .env
npm install
npm run dev              # http://127.0.0.1:5173
```

Abrir **http://127.0.0.1:5173** en el navegador.

> **Nota:** los scripts `setup-cluster.ps1` y `seed.ps1` son **idempotentes** — se pueden re-correr sin romper el cluster.

---

## Cómo probarlo (Linux + bash)

Los scripts de setup del repo son PowerShell, pero el trabajo real lo hacen archivos `.js` ejecutados dentro del contenedor `mongos` con `mongosh` — así que en Linux los invocamos directamente con `docker exec`, sin necesidad de instalar PowerShell.

Primero clona el repo y entra a su raíz:

```bash
git clone https://github.com/SebastianLizarazo/taller-bd-distribuida.git
cd taller-bd-distribuida
```

A partir de aquí necesitas **2 terminales bash abiertas** en la raíz del repo. La primera se usa para el setup inicial y después se queda corriendo el backend; la segunda se queda corriendo el frontend. No las cierres mientras uses la app.

### Terminal 1 — Setup del cluster y backend

```bash
# 1. Levantar los 4 contenedores del sharded cluster (config RS + 2 shards + mongos)
docker compose up -d
sleep 15   # cushion para healthchecks

# 2. Inicializar los 3 replica sets (config-rs + shard01-rs + shard02-rs)
docker exec -i taller-bd-config01 mongosh --port 27017 --quiet < setup/01-init-replicasets.js

# 3. Esperar a que los 3 RS tengan primary (la primera eleccion tarda ~30s)
sleep 30

# 4. Agregar los 2 shards al cluster via mongos
docker exec -i taller-bd-mongos mongosh --port 27017 --quiet < setup/02-add-shards.js

# 5. Habilitar sharding en taller_perfiles y taller_actividad
docker exec -i taller-bd-mongos mongosh --port 27017 --quiet < setup/03-enable-sharding.js

# 6. Insertar seed minimo + forzar split/move entre shards
docker exec -i taller-bd-mongos mongosh --port 27017 --quiet < setup/04-insert-distribution.js

# 7. (Opcional) Seed masivo: 60 usuarios + 600 eventos
docker exec -i taller-bd-mongos mongosh --port 27017 --quiet < setup/05-seed.js

# 8. Backend (esta terminal QUEDA CORRIENDO el proceso de Node — no la cierres)
cd backend
cp .env.example .env
npm install
npm start                # http://localhost:3001
```

### Terminal 2 — Frontend

```bash
# 9. Frontend (esta terminal QUEDA CORRIENDO el dev server de Vite — no la cierres)
cd frontend
cp .env.example .env
npm install
npm run dev              # http://127.0.0.1:5173
```

Abrir **http://127.0.0.1:5173** en el navegador.

> **Nota:** los pasos 2–7 (los `.js`) son **idempotentes** y se pueden re-correr sin romper el cluster. Si tu máquina es lenta y un paso falla, incrementa el `sleep` del paso 3 (a 60–90s) y reintenta.

---

## Arquitectura

```
Cliente React (Vite :5173)
     │  HTTP
     ▼
Express :3001 ─── driver nativo mongodb ───►  mongos :27017
                                                     │
                          ┌──────────────────────────┼──────────────────────────┐
                          │                          │                          │
                  shard01 rs                    │  config RS                  │  shard02 rs
                  pais ∈ {AR, CO}              │  metadata                 │  pais ∈ {ES, MX}
                  eventos user_id < "usr-ES"   │                           │  eventos user_id ≥ "usr-ES"
```

- **Sharing horizontal** = la misma colección, distintas filas por shard.
  - `taller_perfiles.usuarios` shardeada por `{ pais: 1 }` (split en `"ES"`)
  - `taller_actividad.eventos` shardeada por `{ user_id: 1 }` (split en `"usr-ES"`)
- **Sharing vertical** = distintos dominios en distintas DBs, cruzados por `user_id`.
  - DB `taller_perfiles`: `{ _id, nombre, email, pais, fecha_registro }`
  - DB `taller_actividad`: `{ _id, user_id, tipo, payload, timestamp }`
  - Una vista "PerfilCompleto" las une por `user_id`.

---

## Validación del sharding

### 1. Sharing horizontal (filas)

Ir a **Dashboard de shards** (`/shards`) y verificar:
- 2 shards listados, ambos en state `primary`.
- Distribución por país en `taller_perfiles.usuarios`:
  - `AR` (15) + `CO` (15) → `shard01-rs` (badge amarillo)
  - `ES` (15) + `MX` (15) → `shard02-rs` (badge azul)
- Chunks asignados: `{ "shard01-rs": 1, "shard02-rs": 1 }` para cada colección.

**Demostración en vivo:**
- Ir a **Crear usuario**, crear un `AR` → respuesta indica `shard01-rs`, `targeted`.
- Crear un `MX` → respuesta indica `shard02-rs`, `targeted`.

**Verificación con mongosh:**
```powershell
docker exec taller-bd-mongos mongosh --port 27017 --quiet --eval "sh.status()"
docker exec taller-bd-mongos mongosh --port 27017 --quiet --eval "db.getSiblingDB('taller_perfiles').usuarios.getShardDistribution()"
```

### 2. Sharing vertical (columnas / dominios)

Ir a **Listar usuarios** → click en cualquier `usr-AR-001` (o similar) → abrir la vista **PerfilCompleto**.

Verificar:
- "Datos base" viene de `taller_perfiles.usuarios` (sección superior).
- "Datos extendidos" viene de `taller_actividad.eventos` (sección inferior).
- Ambas se unieron con un lookup por `user_id`.
- El badge de shard de cada sección puede coincidir o no — eso depende del sharding key de cada colección.

**Verificación con mongosh:**
```powershell
# El perfil vive en un shard, los eventos en otro (o el mismo).
docker exec taller-bd-mongos mongosh --port 27017 --quiet --eval "db.getSiblingDB('taller_perfiles').usuarios.findOne({_id:'usr-AR-001'})"
docker exec taller-bd-mongos mongosh --port 27017 --quiet --eval "db.getSiblingDB('taller_actividad').eventos.find({user_id:'usr-AR-001'}).toArray()"
```

### 3. Targeted vs scatter-gather

- `GET /api/usuarios?pais=AR` → **targeted** (mongos sabe a qué shard ir por la sharding key).
- `GET /api/usuarios` (sin filtro) → **scatter-gather** (consulta todos los shards y mergea).
- `GET /api/usuarios/usr-AR-001` → **scatter-gather** (porque el lookup es por `_id`, que NO es la sharding key).

El log del backend (con `LOG_LEVEL=debug`) muestra cada decisión de shard en formato `shard-target usuarios.find {...}`. En la UI se ve el badge `targeted` o `scatter`.

---

## Endpoints REST

### Backend (Express :3001)

| Método | Path | Descripción | Sharing |
|---|---|---|---|
| `GET` | `/health` | Ping + versión + # shards | — |
| `POST` | `/api/usuarios` | Crear usuario | horizontal (targeted) |
| `GET` | `/api/usuarios` | Listar (opcional `?pais=`) | targeted si hay filtro |
| `GET` | `/api/usuarios/:id` | Buscar por id | scatter-gather |
| `DELETE` | `/api/usuarios/:id` | Eliminar | scatter-gather |
| `POST` | `/api/usuarios/:id/eventos` | Crear evento | horizontal (targeted) |
| `GET` | `/api/usuarios/:id/eventos` | Listar eventos del usuario | horizontal (targeted) |
| `GET` | `/api/admin/shard-status` | Estado del cluster | — |
| `GET` | `/api/admin/distribucion` | Por país / por tipo / chunks por shard | — |
| `GET` | `/api/admin/donde-esta/:user_id` | Dónde vive cada dato del user | sharing vertical |
| `GET` | `/api/admin/balance` | Resumen ejecutivo | — |

---

## Estructura del repo

```
taller-bd-distribuida/
├── docker-compose.yml          # config01 + shard01a + shard02a + mongos
├── README.md                   # este archivo
├── odd/
│   └── tasks/
│       └── taller-sharding-mongodb.md   # plan del taller
├── setup/                      # scripts mongosh + PowerShell
│   ├── setup-cluster.ps1       # orquestador del cluster
│   ├── seed.ps1                # seed de datos
│   ├── 01-init-replicasets.js
│   ├── 02-add-shards.js
│   ├── 03-enable-sharding.js
│   ├── 04-insert-distribution.js
│   └── 05-seed.js
├── backend/                    # Node + Express + driver mongodb
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── index.js            # bootstrap
│       ├── db.js               # cliente singleton
│       └── routes/
│           ├── health.js
│           ├── usuarios.js     # CRUD
│           ├── eventos.js      # CRUD
│           └── admin.js        # observabilidad
└── frontend/                   # React 18 + Vite + React Router 6
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── api/client.js
        ├── styles/global.css
        ├── components/
        │   ├── ShardBadge.jsx
        │   └── UserCard.jsx
        └── pages/
            ├── Home.jsx
            ├── CrearUsuario.jsx
            ├── ListarUsuarios.jsx
            ├── PerfilCompleto.jsx
            └── DashboardShards.jsx
```

---

## Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| `docker compose ps` muestra `unhealthy` | Healthcheck del mongos depende del config-rs | Esperar 60s. Re-correr `.\setup\setup-cluster.ps1`. |
| `mongosh --host localhost:27017` rechaza conexiones | El mongos quedó zombie | `docker compose restart mongos` |
| Backend arranca pero `/health` da 503 | Conexión al mongos falló | Verificar `MONGOS_URI` en `backend/.env`. Verificar que `docker compose ps` muestre mongos healthy. |
| `npm run dev` falla con `EADDRINUSE` | Otra instancia de Vite corriendo | Matar con `Get-Process node \| Stop-Process` (Windows) o `pkill -f "vite"` (Linux/Mac) |
| Vite tira `Expected ":" but found "}"` en JSX | Bug de escape de `{` en template literal | Re-guardar el archivo afectado (ver src/pages/PerfilCompleto.jsx línea 96). |
| El cluster no se inicializa tras `docker compose down -v` | Volúmenes borrados, replica sets perdidos | Re-correr `.\setup\setup-cluster.ps1` (es idempotente). |

---

## Cleanup

```powershell
# Apagar contenedores (conserva los datos)
docker compose down

# Apagar Y borrar todos los datos
docker compose down -v
```

---
