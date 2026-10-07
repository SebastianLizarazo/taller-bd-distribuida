import { MongoClient } from 'mongodb';

const MONGOS_URI = process.env.MONGOS_URI || 'mongodb://localhost:27017';

const PREFIJO = '[taller-bd]';

let cliente = null;
let promesaConexion = null;

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

/**
 * Abre la conexión al mongos. Idempotente: si ya hay un cliente conectado
 * (o una promesa de conexión en curso), la retorna sin volver a conectar.
 */
export async function connect() {
  if (cliente) {
    return cliente;
  }
  if (promesaConexion) {
    return promesaConexion;
  }

  log('info', `conectando a mongos en ${MONGOS_URI}`);
  promesaConexion = (async () => {
    const c = new MongoClient(MONGOS_URI, {});
    await c.connect();
    cliente = c;
    log('info', 'conexion con mongos establecida');
    return c;
  })();

  try {
    return await promesaConexion;
  } finally {
    promesaConexion = null;
  }
}

/**
 * Devuelve la instancia singleton del cliente.
 * Lanza si todavía no se llamó a connect().
 */
export function getClient() {
  if (!cliente) {
    throw new Error('MongoClient no inicializado: llamar primero a connect()');
  }
  return cliente;
}

/**
 * Helper para obtener una DB arbitraria por nombre.
 */
export function getDb(nombre) {
  return getClient().db(nombre);
}

/**
 * Helpers específicos del taller — devuelven las DBs que demuestran
 * sharing vertical (perfiles en una DB, actividad en otra).
 */
export function getPerfiles() {
  return getDb('taller_perfiles');
}

export function getActividad() {
  return getDb('taller_actividad');
}

/**
 * Cierra la conexión al cluster. Pensado para tests y shutdown graceful.
 */
export async function close() {
  if (cliente) {
    log('info', 'cerrando conexion con mongos');
    await cliente.close();
    cliente = null;
  }
}

/**
 * Helper de logging para T05+ que muestre a qué shard fue cada query.
 * Por ahora solo loggea; cuando esté `explain('executionStats')` en los
 * handlers CRUD, acá se formatea la info de shard destino.
 *
 * @param {string} operacion  ej: 'usuarios.find', 'usuarios.insertOne'
 * @param {object} meta       ej: { shard: 'shard01', targeted: true }
 */
export function logShard(operacion, meta) {
  if (process.env.LOG_LEVEL !== 'debug') return;
  log('debug', `shard-target ${operacion}`, meta);
}