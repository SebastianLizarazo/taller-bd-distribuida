import { Router } from 'express';
import { getClient } from '../db.js';

const router = Router();

function timestamp() {
  return new Date().toISOString();
}

/**
 * GET /health
 * - Ping al cluster para verificar que mongos responde.
 * - Devuelve version del server, cantidad de shards y timestamp.
 * - 200 si todo OK, 503 si el cluster no responde.
 */
router.get('/health', async (req, res) => {
  try {
    const client = getClient();
    const admin = client.db().admin();   // getClient() returns MongoClient; .db() without args defaults to "admin"; .admin() returns the Admin helper

    const pingResult = await admin.command({ ping: 1 });
    if (pingResult.ok !== 1) {
      throw new Error(`ping devolvio ok=${pingResult.ok}`);
    }

    const buildInfo = await admin.command({ buildInfo: 1 });
    const version = buildInfo.version || 'desconocida';

    let shards = 0;
    try {
      const shardsInfo = await admin.command({ listShards: 1 });
      shards = Array.isArray(shardsInfo.shards) ? shardsInfo.shards.length : 0;
    } catch {
      // listShards solo funciona desde mongos. Si falla, devolvemos 0
      // en vez de romper el healthcheck.
    }

    res.status(200).json({
      ok: true,
      version,
      shards,
      timestamp: timestamp(),
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: err && err.message ? err.message : String(err),
      timestamp: timestamp(),
    });
  }
});

export default router;