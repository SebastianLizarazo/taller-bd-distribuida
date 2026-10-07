import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import ShardBadge from '../components/ShardBadge.jsx';

export default function PerfilCompleto() {
  const { id } = useParams();
  const [perfil, setPerfil] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [donde, setDonde] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    Promise.all([
      api.obtenerUsuario(id),
      api.listarEventos(id, { limit: 20 }),
      api.dondeEsta(id),
    ]).then(([p, ev, d]) => {
      setPerfil(p.usuario);
      setEventos(ev.eventos);
      setDonde(d);
    }).catch(e => setErr(e.response?.data?.error || e.message));
  }, [id]);

  if (err) return <div className="error">Error: {err}</div>;
  if (!perfil || !donde) return 'Cargando...';

  return (
    <div>
      <h1>Perfil completo <small style={{ color: 'var(--text-dim)' }}>cruzando 2 bases (sharing vertical)</small></h1>

      <div className="card">
        <h2>
          Datos base <small>viene de <code>taller_perfiles.usuarios</code></small>
        </h2>
        <div className="row"><span className="grow">_id</span><code>{perfil._id}</code></div>
        <div className="row"><span className="grow">Nombre</span><span>{perfil.nombre}</span></div>
        <div className="row"><span className="grow">Email</span><span>{perfil.email}</span></div>
        <div className="row"><span className="grow">País</span><span><strong>{perfil.pais}</strong></span></div>
        <div className="row"><span className="grow">Fecha registro</span><span>{new Date(perfil.fecha_registro).toLocaleDateString()}</span></div>
        <div className="row" style={{ marginTop: 12 }}>
          <span className="grow">Shard destino (vía /admin/donde-esta)</span>
          <ShardBadge shard={donde.perfil.shard_destino} label={donde.perfil.shard_destino} />
        </div>
      </div>

      <div className="card">
        <h2>
          Datos extendidos <small>viene de <code>taller_actividad.eventos</code>, {eventos.length} documentos</small>
        </h2>
        {eventos.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>Sin eventos para este usuario.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Payload</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {eventos.map(e => (
                <tr key={e._id}>
                  <td><code>{e.tipo}</code></td>
                  <td><pre className="code" style={{ margin: 0 }}>{JSON.stringify(e.payload, null, 0)}</pre></td>
                  <td>{new Date(e.timestamp).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <span className="grow">Shard destino de los eventos</span>
          <ShardBadge shard={donde.eventos.shard_destino} label={donde.eventos.shard_destino} />
        </div>
      </div>

      <div className="card" style={{ borderColor: 'var(--accent)' }}>
        <h2>Prueba del sharing vertical <small>↑ esta vista ya lo demuestra</small></h2>
        <p>
          Esta página se construyó combinando <strong>2 bases de datos distintas</strong>:
          los datos base del usuario viven en <code>taller_perfiles</code>, los eventos en
          <code> taller_actividad</code>. La unión se hace por el campo <code>user_id</code>.
          Eso es <strong>sharing vertical</strong> aplicado a nivel de base de datos.
        </p>
        <p>
          <strong>¿Y el horizontal?</strong> Cada una de esas bases tiene además sus documentos
          repartidos entre los 2 shards por su sharding key:
        </p>
        <ul>
          <li><code>taller_perfiles.usuarios</code> shardeada por <code>{'{ pais: 1 }'}</code></li>
          <li><code>taller_actividad.eventos</code> shardeada por <code>{'{ user_id: 1 }'}</code></li>
        </ul>
        <p style={{ color: 'var(--text-dim)' }}>
          En este taller los user_id arrancan con el prefijo <code>usr-{'{PAIS}'}</code>, así que el
          shard del perfil y el shard de los eventos terminan coincidiendo para el mismo usuario.
          En un sistema real (con user_id hash-like, ej. ObjectIds), la cardinalidad hace que
          puedan caer en shards distintos — eso sería un cruce vertical+horizontal aún más
          interesante.
        </p>
      </div>

      <p>
        <Link to="/usuarios">← Volver al listado</Link>
      </p>
    </div>
  );
}