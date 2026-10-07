import 'dotenv/config';

import express from 'express';
import cors from 'cors';

import { connect, close } from './db.js';
import healthRouter from './routes/health.js';
import usuariosRouter from './routes/usuarios.js';
import eventosRouter from './routes/eventos.js';
import adminRouter from './routes/admin.js';

const PREFIJO = '[taller-bd]';
const PORT = Number(process.env.PORT) || 3001;

function timestamp() {
  return new Date().toISOString();
}

function log(nivel, mensaje, extra) {
  const linea = `${timestamp()} ${PREFIJO} [${nivel}] ${mensaje}`;
  if (extra !== undefined) {
    console.log(linea, extra);
  } else {
    console.log(linea);
  }
}

// 1. App Express con middleware base.
const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json());

// 2. Logger middleware: loggear cada request entrante.
app.use((req, res, next) => {
  log('info', `[req] ${req.method} ${req.path}`);
  next();
});

// 3. Rutas.
app.use('/', healthRouter);
app.use('/api/usuarios', usuariosRouter);
app.use('/api', eventosRouter);
app.use('/api/admin', adminRouter);

// 4. 404 para rutas no montadas (T05 va a sumar /api/*).
app.use((req, res) => {
  res.status(404).json({ ok: false, error: `ruta no encontrada: ${req.method} ${req.path}` });
});

// 5. Error handler global.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  log('error', `error no manejado en ${req.method} ${req.path}: ${err.message}`);
  res.status(500).json({ ok: false, error: err.message || 'error interno' });
});

// 6. Shutdown graceful.
async function shutdown(signal) {
  log('info', `senal ${signal} recibida, cerrando...`);
  await close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// 7. Bootstrap: conectar al cluster antes de aceptar requests.
async function bootstrap() {
  try {
    await connect();
    app.listen(PORT, () => {
      log('info', `backend escuchando en http://localhost:${PORT}`);
    });
  } catch (err) {
    log('error', `fallo el bootstrap: ${err.message}`);
    process.exit(1);
  }
}

bootstrap();