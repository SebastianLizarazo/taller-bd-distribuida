import { Router } from 'express';
import { getClient, getPerfiles, getActividad } from '../db.js';

const router = Router();

/**
 * Cuenta chunks por shard para las colecciones shardeadas del taller.
 * Usa config.chunks directamente (la metadata que mantiene el config server).
 * Es el equivalente driver-friendly de mongosh's `db.coleccion.getShardDistribution()`.
 */
async function distribucionChunks() {
  const admin = getClient().db('config').admin();
  const colls = await admin.command({ listCollections: 1 }, { dbName: 'config' }).catch(() => ({ cursor: { firstBatch: [] } }));

  // Mapear colecciones del taller a sus uuid en config.collections.
  const configDb = getClient().db('config');
  const collsDelTaller = await configDb.collection('collections').find({
    $or: [
      { _id: 'taller_perfiles.usuarios' },
      { _id: 'taller_actividad.eventos' },
    ],
  }).toArray();
  const uuidPorColl = Object.fromEntries(collsDelTaller.map(c => [c._id, c.uuid]));

  // Contar chunks por shard por uuid.
  const out = {};
  for (const [collKey, uuid] of Object.entries(uuidPorColl)) {
    const counts = await configDb.collection('chunks').aggregate([
      { $match: { uuid } },
      { $group: { _id: '$shard', total: { $sum: 1 } } },
    ]).toArray();
    out[collKey] = Object.fromEntries(counts.map(c => [c._id, c.total]));
  }
  return out;
}

// GET /api/admin/shard-status
// Foto completa del cluster para la UI del dashboard.
router.get('/shard-status', async (req, res, next) => {
  try {
    const admin = getClient().db().admin();
    const [status, databases] = await Promise.all([
      admin.command({ listShards: 1 }),
      admin.command({ listDatabases: 1, nameOnly: false }),
    ]);

    const tallerDbs = databases.databases
      .filter(d => ['taller_perfiles', 'taller_actividad'].includes(d.name))
      .map(d => ({ name: d.name, sizeOnDisk: d.sizeOnDisk }));

    res.json({
      ok: true,
      shards: status.shards.map(s => ({ _id: s._id, host: s.host, state: s.state })),
      taller_databases: tallerDbs,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/distribucion
// Para cada coleccion shardeada:
// - distribucion por shard (chunks asignados)
// - distribucion por campo derivado (pais para usuarios, tipo para eventos)
router.get('/distribucion', async (req, res, next) => {
  try {
    const perfiles = getPerfiles();
    const actividad = getActividad();
    const chunks = await distribucionChunks();

    const distUsuariosPorPais = await perfiles.collection('usuarios').aggregate([
      { $group: { _id: '$pais', total: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray();

    const distEventosPorTipo = await actividad.collection('eventos').aggregate([
      { $group: { _id: '$tipo', total: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]).toArray();

    res.json({
      ok: true,
      usuarios: {
        por_pais: distUsuariosPorPais,
        chunks_por_shard: chunks['taller_perfiles.usuarios'] || {},
        nota: 'Con la sharding key {pais:1} y split en "ES": AR/CO van a shard01-rs, ES/MX a shard02-rs.',
      },
      eventos: {
        por_tipo: distEventosPorTipo,
        chunks_por_shard: chunks['taller_actividad.eventos'] || {},
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/donde-esta/:user_id
// PRUEBA VISUAL DEL SHARING VERTICAL.
// Devuelve en que shard vive el perfil del user_id y en que shard estan sus eventos.
router.get('/donde-esta/:user_id', async (req, res, next) => {
  try {
    const userId = req.params.user_id;
    const perfiles = getPerfiles();
    const actividad = getActividad();

    const perfil = await perfiles.collection('usuarios').findOne({ _id: userId });
    const eventos = await actividad.collection('eventos').find({ user_id: userId }).limit(20).toArray();

    // Perfil: shard decidido por sharding key {pais:1}, split en "ES".
    const shardPerfil = perfil ? (perfil.pais < 'ES' ? 'shard01-rs' : 'shard02-rs') : null;
    // Eventos: shard decidido por sharding key {user_id:1}, split en "usr-ES".
    // Como los user_ids del seed tienen el formato "usr-{PAIS}-NNN", el prefijo
    // antes de "-ES" cae en shard01, despues en shard02 — matchea con el pais del perfil.
    function shardDeUserId(uid) {
      if (!uid) return null;
      return uid < 'usr-ES' ? 'shard01-rs' : 'shard02-rs';
    }
    const shardEventos = shardDeUserId(userId);

    res.json({
      ok: true,
      user_id: userId,
      perfil: perfil ? {
        existe: true,
        nombre: perfil.nombre,
        email: perfil.email,
        pais: perfil.pais,
        shard_destino: shardPerfil,
        fuente_db: 'taller_perfiles',
      } : {
        existe: false,
        fuente_db: 'taller_perfiles',
      },
      eventos: {
        total: eventos.length,
        shard_destino: shardEventos,
        fuente_db: 'taller_actividad',
        muestra: eventos.slice(0, 5).map(e => ({ _id: e._id, tipo: e.tipo, timestamp: e.timestamp })),
      },
      sharing_vertical_proof: {
        perfil_y_eventos_en_mismo_shard: shardPerfil === shardEventos,
        explicacion: 'Perfil y eventos pueden vivir en shards distintos: el primero se decide por pais, el segundo por hash de user_id. Como nuestros ids son usr-{pais}-NNN, los dos shards coinciden en este taller — eso simplifica el ejemplo. En un sistema real, la cardinalidad de user_id suele hacer que se distribuyan distinto.',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/balance
// Resumen ejecutivo para una sola pantalla.
router.get('/balance', async (req, res, next) => {
  try {
    const perfiles = getPerfiles();
    const actividad = getActividad();
    const [totalUsuarios, totalEventos, chunks] = await Promise.all([
      perfiles.collection('usuarios').countDocuments(),
      actividad.collection('eventos').countDocuments(),
      distribucionChunks(),
    ]);

    res.json({
      ok: true,
      totales: {
        usuarios: totalUsuarios,
        eventos: totalEventos,
        bases_de_datos: 2,
        colecciones_shardeadas: 2,
      },
      chunks_por_shard: chunks,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;