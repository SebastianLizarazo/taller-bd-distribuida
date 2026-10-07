import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import UserCard from '../components/UserCard.jsx';

const PAISES = ['', 'AR', 'MX', 'CO', 'ES'];

export default function ListarUsuarios() {
  const [pais, setPais] = useState('');
  const [usuarios, setUsuarios] = useState([]);
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function cargar() {
    setCargando(true); setErr(null);
    try {
      const r = await api.listarUsuarios({ pais: pais || undefined, limit: 50 });
      setUsuarios(r.usuarios);
      setMeta(r.meta);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => { cargar(); }, [pais]);

  return (
    <div>
      <h1>Listar usuarios</h1>
      <p style={{ color: 'var(--text-dim)' }}>
        Filtrá por país para ver el badge <strong>targeted</strong> (query va a 1 shard). Sin filtro,
        la query es <strong>scatter-gather</strong> (consulta todos los shards y los mergea en mongos).
      </p>

      <div className="card">
        <div className="row">
          <label style={{ minWidth: 80 }}>País:</label>
          <select value={pais} onChange={e => setPais(e.target.value)} style={{ width: 200 }}>
            {PAISES.map(p => <option key={p} value={p}>{p || '(todos — scatter-gather)'}</option>)}
          </select>
        </div>
      </div>

      {err && <div className="error">{err}</div>}

      {meta && (
        <div className="card">
          <h2>Query ejecutada <small>lo que respondió el backend</small></h2>
          <div className="row">
            <span className="grow">Filtro</span>
            <code>{JSON.stringify(meta.filter || {})}</code>
          </div>
          <div className="row">
            <span className="grow">Operación</span>
            <span className={meta.operacion === 'targeted' ? 'ok' : ''} style={{ fontWeight: 600 }}>
              {meta.operacion}
            </span>
          </div>
          <div className="row">
            <span className="grow">Shards consultados</span>
            <code>{meta.shard_destino}</code>
          </div>
          <div className="row">
            <span className="grow">Documentos devueltos</span>
            <strong>{usuarios.length}</strong>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Resultados <small>{cargando ? 'cargando...' : ''}</small></h2>
        {usuarios.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>Sin resultados.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>_id</th>
                <th>Nombre</th>
                <th>Email</th>
                <th>País</th>
                <th>Sharding</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => <UserCard key={u._id} usuario={u} shardForQuery={meta?.shard_destino} />)}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}