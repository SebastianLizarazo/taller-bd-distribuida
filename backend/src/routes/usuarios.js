import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getPerfiles, logShard } from '../db.js';

const router = Router();

// POST /api/usuarios
// Body: { nombre, email, pais }
// pais debe ser uno de {AR, MX, CO, ES}. MongoDB rutea el insert al shard
// correcto segun la sharding key {pais:1} — ese routing es el corazon del
// sharing horizontal y la respuesta del POST lo demuestra.
router.post('/', async (req, res, next) => {
  try {
    const { nombre, email, pais } = req.body || {};
    if (!nombre || !email || !pais) {
      return res.status(400).json({ ok: false, error: 'faltan campos: nombre, email, pais' });
    }
    const paisesValidos = ['AR', 'MX', 'CO', 'ES'];
    if (!paisesValidos.includes(pais)) {
      return res.status(400).json({ ok: false, error: `pais invalido. Esperado uno de ${paisesValidos.join(',')}` });
    }

    const _id = `usr-${pais}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
    const doc = {
      _id,
      nombre,
      email,
      pais,
      fecha_registro: new Date(),
    };

    const col = getPerfiles().collection('usuarios');
    const result = await col.insertOne(doc);

    // Targeted insert: sabemos el shard destino por la sharding key pais.
    // AR/CO caen en shard01-rs, MX/ES en shard02-rs (split en "ES").
    const shardDestino = (pais < 'ES') ? 'shard01-rs' : 'shard02-rs';
    logShard('usuarios.insertOne', { _id, pais, shard: shardDestino, targeted: true });

    res.status(201).json({
      ok: true,
      usuario: { ...doc, _id: result.insertedId },
      meta: { shard_destino: shardDestino, operacion: 'targeted', sharding_key: { pais } },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/usuarios?pais=AR
// Query targeted: filtra por la sharding key → va a un solo shard.
// Si no se pasa ?pais, hace scatter-gather (consulta todos los shards).
router.get('/', async (req, res, next) => {
  try {
    const { pais, skip = '0', limit = '50' } = req.query;
    const filter = {};
    if (pais) filter.pais = pais;

    const col = getPerfiles().collection('usuarios');
    const cursor = col.find(filter).sort({ _id: 1 }).skip(Number(skip)).limit(Number(limit));
    const docs = await cursor.toArray();

    // Decidir shard destino en base al filtro. Sin sharding key = scatter-gather.
    let shardDestino;
    let operacion;
    if (pais) {
      shardDestino = (pais < 'ES') ? 'shard01-rs' : 'shard02-rs';
      operacion = 'targeted';
    } else {
      shardDestino = 'shard01-rs + shard02-rs';
      operacion = 'scatter-gather';
    }
    logShard('usuarios.find', { filter, count: docs.length, shard: shardDestino, targeted: pais !== undefined });

    res.json({
      ok: true,
      count: docs.length,
      filter,
      usuarios: docs,
      meta: { shard_destino: shardDestino, operacion },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/usuarios/:id
// Lookup targeted por _id. Como _id NO es la sharding key, mongos hace
// scatter-gather consultando TODOS los shards para encontrar el doc.
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const col = getPerfiles().collection('usuarios');
    const doc = await col.findOne({ _id: id });

    // Inferir shard destino: por la sharding key {pais}, NO por _id.
    // mongos tiene que mirar en todos los shards para encontrar el doc.
    let shardDestino = 'shard01-rs + shard02-rs';
    let operacion = 'scatter-gather';
    if (doc) {
      shardDestino = (doc.pais < 'ES') ? 'shard01-rs' : 'shard02-rs';
      operacion = 'found';
    }

    logShard('usuarios.findOne', { _id: id, shard: shardDestino, found: !!doc });

    if (!doc) {
      return res.status(404).json({ ok: false, error: `usuario ${id} no existe`, meta: { shard_destino: shardDestino, operacion } });
    }
    res.json({ ok: true, usuario: doc, meta: { shard_destino: shardDestino, operacion } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/usuarios/:id
// Para que la UI pueda limpiar durante la demo.
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const col = getPerfiles().collection('usuarios');
    const result = await col.deleteOne({ _id: id });
    logShard('usuarios.deleteOne', { _id: id, deletedCount: result.deletedCount });
    res.json({ ok: true, deletedCount: result.deletedCount, meta: { operacion: 'scatter-gather (busca _id en todos los shards)' } });
  } catch (err) {
    next(err);
  }
});

export default router;