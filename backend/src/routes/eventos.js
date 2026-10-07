import { Router } from 'express';
import { getActividad, logShard } from '../db.js';

const router = Router();

// POST /api/usuarios/:id/eventos
// Body: { tipo, payload }
// Inserta en taller_actividad.eventos shardeada por user_id.
// El user_id lo sacamos del path param (la API lo modela como recurso del usuario).
router.post('/usuarios/:id/eventos', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { tipo, payload = {} } = req.body || {};
    const tiposValidos = ['login', 'purchase', 'view_product', 'add_to_cart', 'review', 'search', 'share', 'like'];
    if (!tipo) {
      return res.status(400).json({ ok: false, error: 'falta campo: tipo' });
    }
    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({ ok: false, error: `tipo invalido. Esperado uno de ${tiposValidos.join(',')}` });
    }

    const _id = `evt-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
    const doc = {
      _id,
      user_id: userId,
      tipo,
      payload,
      timestamp: new Date(),
    };

    const col = getActividad().collection('eventos');
    const result = await col.insertOne(doc);

    // Targeted insert por la sharding key user_id.
    // El hash del user_id decide el shard — distinto al shard donde vive el perfil del usuario
    // (que se decide por su pais). Por eso un perfil y sus eventos pueden vivir en shards
    // DIFERENTES — eso es justamente lo que demuestra el sharing vertical con cruce horizontal.
    logShard('eventos.insertOne', { _id, user_id: userId, shard: 'hash(user_id) decide', targeted: true });

    res.status(201).json({
      ok: true,
      evento: { ...doc, _id: result.insertedId },
      meta: {
        operacion: 'targeted',
        sharding_key: { user_id: userId },
        nota: 'El shard destino lo decide el hash de user_id, no el pais del usuario. Perfil y eventos pueden vivir en shards distintos — eso ES el sharing vertical.',
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/usuarios/:id/eventos
// Query targeted por user_id (la sharding key de eventos).
router.get('/usuarios/:id/eventos', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { tipo, limit = '50' } = req.query;
    const filter = { user_id: userId };
    if (tipo) filter.tipo = tipo;

    const col = getActividad().collection('eventos');
    const docs = await col.find(filter).sort({ timestamp: -1 }).limit(Number(limit)).toArray();

    logShard('eventos.find', { user_id: userId, count: docs.length, shard: 'shard deterministico por user_id', targeted: true });

    res.json({
      ok: true,
      count: docs.length,
      filter,
      eventos: docs,
      meta: { shard_destino: 'hash(user_id) — un solo shard', operacion: 'targeted' },
    });
  } catch (err) {
    next(err);
  }
});

export default router;