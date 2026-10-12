import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import ShardBadge from '../components/ShardBadge.jsx';

export default function DashboardShards() {
  const [status, setStatus] = useState(null);
  const [dist, setDist] = useState(null);
  const [balance, setBalance] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    Promise.all([api.shardStatus(), api.distribucion(), api.balance()])
      .then(([s, d, b]) => { setStatus(s); setDist(d); setBalance(b); })
      .catch(e => setErr(e.message));
  }, []);

  if (err) return <div className="error">Error: {err}</div>;
  if (!status || !dist || !balance) return 'Cargando...';

  const totalUsuarios = dist.usuarios.por_pais.reduce((s, p) => s + p.total, 0);
  const totalEventos = dist.eventos.por_tipo.reduce((s, p) => s + p.total, 0);

  return (
    <div>
      <h1>Dashboard de shards</h1>
      <p style={{ color: 'var(--text-dim)' }}>
        Vista administrativa: estado del cluster, distribución por shard y prueba visual del sharing horizontal.
      </p>

      <div className="card">
        <h2>Shards activos <small>vía /api/admin/shard-status</small></h2>
        <table>
          <thead>
            <tr><th>_id</th><th>Host</th><th>State</th></tr>
          </thead>
          <tbody>
            {status.shards.map(s => (
              <tr key={s._id}>
                <td><code>{s._id}</code></td>
                <td><code>{s.host}</code></td>
                <td>
                  <ShardBadge shard={s.state === 1 ? s._id : ''} label={s.state === 1 ? '● primary' : '○ secondary'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>
          Distribución de <code>taller_perfiles.usuarios</code>
          <small>sharding key: { '{ pais: 1 }' }</small>
        </h2>
        <p style={{ color: 'var(--text-dim)' }}>
          Split point en <code>"ES"</code> → AR/CO caen en shard01, ES/MX en shard02.
        </p>
        <div className="bar">
          {dist.usuarios.por_pais.map(p => {
            const pct = (p.total / totalUsuarios) * 100;
            const cls = (p._id < 'ES') ? 'shard1-frag' : 'shard2-frag';
            return (
              <div key={p._id} className={cls} style={{ width: `${pct}%` }} title={`${p._id}: ${p.total} (${pct.toFixed(1)}%)`}>
                {p._id} ({p.total})
              </div>
            );
          })}
        </div>
        <div className="legend">
          <span><span className="dot" style={{ background: 'var(--shard1)' }}></span>shard01-rs (AR, CO)</span>
          <span><span className="dot" style={{ background: 'var(--shard2)' }}></span>shard02-rs (ES, MX)</span>
        </div>
        <div style={{ marginTop: 12, color: 'var(--text-dim)', fontSize: 12 }}>
          Chunks asignados: <code>{JSON.stringify(dist.usuarios.chunks_por_shard)}</code>
        </div>
      </div>

      <div className="card">
        <h2>
          Distribución de <code>taller_actividad.eventos</code>
          <small>sharding key: { '{ user_id: 1 }' }</small>
        </h2>
        <p style={{ color: 'var(--text-dim)' }}>
          Split point en <code>"usr-ES"</code> → 300 eventos por shard.
        </p>
        <div className="bar">
          {dist.eventos.por_tipo.map(t => {
            const pct = (t.total / totalEventos) * 100;
            return (
              <div key={t._id} className="shard1-frag" style={{ width: `${pct}%`, background: 'var(--panel-2)', color: 'var(--text-dim)' }} title={`${t._id}: ${t.total}`}>
                {t._id.length > 6 ? t._id.slice(0, 6) : t._id} ({t.total})
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 12, color: 'var(--text-dim)', fontSize: 12 }}>
          Chunks asignados: <code>{JSON.stringify(dist.eventos.chunks_por_shard)}</code>
        </div>
      </div>

      <div className="card">
        <h2>Totales</h2>
        <div className="row"><span className="grow">Bases de datos</span><span>{balance.totales.bases_de_datos}</span></div>
        <div className="row"><span className="grow">Colecciones shardeadas</span><span>{balance.totales.colecciones_shardeadas}</span></div>
        <div className="row"><span className="grow">Usuarios totales</span><span><strong>{balance.totales.usuarios}</strong></span></div>
        <div className="row"><span className="grow">Eventos totales</span><span><strong>{balance.totales.eventos}</strong></span></div>
      </div>

      <div className="card" style={{ borderColor: 'var(--accent)' }}>
        <h2>Resumen</h2>
        <ul>
          <li><strong>Sharing horizontal:</strong> cada colección shardeada reparte sus filas entre
            shard01-rs y shard02-rs según su sharding key. Verificable en los gráficos de arriba.</li>
          <li><strong>Sharing vertical:</strong> los datos viven en 2 bases distintas
            (<code>taller_perfiles</code> y <code>taller_actividad</code>), cruzadas por
            <code> user_id</code>. Verificable abriendo el perfil completo de cualquier usuario.</li>
          <li><strong>Proof points para mongosh:</strong>
            <pre className="code">{`# Ver el estado del cluster:
docker exec taller-bd-mongos mongosh --port 27017 --eval "sh.status()"

# Ver distribución de una colección:
docker exec taller-bd-mongos mongosh --port 27017 --eval \\
  "db.getSiblingDB('taller_perfiles').usuarios.getShardDistribution()"

# Ver dónde está un user_id específico:
docker exec taller-bd-mongos mongosh --port 27017 --eval \\
  "db.getSiblingDB('taller_perfiles').usuarios.findOne({_id:'usr-AR-001'})"`}</pre>
          </li>
        </ul>
      </div>
    </div>
  );
}