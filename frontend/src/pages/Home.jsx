import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import ShardBadge from '../components/ShardBadge.jsx';

export default function Home() {
  const [health, setHealth] = useState(null);
  const [balance, setBalance] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    Promise.all([api.health(), api.balance()])
      .then(([h, b]) => { setHealth(h); setBalance(b); })
      .catch(e => setErr(e.message));
  }, []);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Sharing horizontal + vertical con MongoDB</h1>
      <p style={{ color: 'var(--text-dim)' }}>
        Demostración de <strong>sharding horizontal</strong> (filas repartidas por sharding key entre
        2 shards) y <strong>sharding vertical</strong> (datos base y datos extendidos en bases separadas,
        cruzados por user_id).
      </p>

      {err && <div className="error">Error: {err}</div>}

      <div className="grid-2">
        <div className="card">
          <h2>Cluster <small>vía /health</small></h2>
          {health ? (
            <div>
              <div className="row"><span className="grow">Versión</span><span>{health.version}</span></div>
              <div className="row"><span className="grow">Shards activos</span><span>{health.shards}</span></div>
              <div className="row"><span className="grow">Status</span><span className="ok">● online</span></div>
            </div>
          ) : 'Cargando...'}
        </div>
        <div className="card">
          <h2>Datos cargados <small>vía /admin/balance</small></h2>
          {balance ? (
            <div>
              <div className="row"><span className="grow">Usuarios</span><span>{balance.totales.usuarios}</span></div>
              <div className="row"><span className="grow">Eventos</span><span>{balance.totales.eventos}</span></div>
              <div className="row"><span className="grow">Bases de datos</span><span>{balance.totales.bases_de_datos}</span></div>
              <div className="row"><span className="grow">Colecciones shardeadas</span><span>{balance.totales.colecciones_shardeadas}</span></div>
            </div>
          ) : 'Cargando...'}
        </div>
      </div>

      <div className="card">
        <h2>Cómo se demuestra el sharding</h2>
        <ol>
          <li>
            <strong>Horizontal (filas):</strong> ir a <Link to="/usuarios">Listar usuarios</Link>,
            filtrar por país (ej. <code>AR</code> o <code>MX</code>) y ver el badge "targeted" —
            significa que la query fue a un solo shard.
          </li>
          <li>
            <strong>Vertical (columnas):</strong> hacer click en cualquier usuario, ir a
            <em> PerfilCompleto</em>, y ver cómo se cruzan los datos de dos bases diferentes
            (<code>taller_perfiles</code> + <code>taller_actividad</code>) por user_id.
          </li>
          <li>
            <strong>Dashboard:</strong> ir a <Link to="/shards">Dashboard de shards</Link> para ver
            el estado del cluster, la distribución por shard y la prueba de sharing vertical.
          </li>
        </ol>
      </div>
    </div>
  );
}