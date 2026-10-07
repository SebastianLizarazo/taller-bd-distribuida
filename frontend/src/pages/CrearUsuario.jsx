import { useState } from 'react';
import { api } from '../api/client.js';
import ShardBadge from '../components/ShardBadge.jsx';

const PAISES = ['AR', 'MX', 'CO', 'ES'];

export default function CrearUsuario() {
  const [form, setForm] = useState({ nombre: '', email: '', pais: 'AR' });
  const [resp, setResp] = useState(null);
  const [err, setErr] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setErr(null); setResp(null); setCargando(true);
    try {
      const r = await api.crearUsuario(form);
      setResp(r);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div>
      <h1>Crear usuario</h1>
      <p style={{ color: 'var(--text-dim)' }}>
        Al guardar, el documento se inserta en el shard correspondiente a su país (sharding key: <code>{'{ pais: 1 }'}</code>).
      </p>

      <div className="card" style={{ maxWidth: 500 }}>
        <form onSubmit={onSubmit}>
          <div className="row">
            <input
              placeholder="Nombre"
              value={form.nombre}
              onChange={e => setForm({ ...form, nombre: e.target.value })}
              required
            />
          </div>
          <div className="row">
            <input
              type="email"
              placeholder="email@ejemplo.com"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>
          <div className="row">
            <select value={form.pais} onChange={e => setForm({ ...form, pais: e.target.value })}>
              {PAISES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <button type="submit" disabled={cargando}>
              {cargando ? 'Guardando...' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>

      {err && <div className="error">{err}</div>}

      {resp && (
        <div className="card">
          <h2>Resultado <small>con info de shard</small></h2>
          <div className="row">
            <span className="grow">_id generado</span>
            <code>{resp.usuario._id}</code>
          </div>
          <div className="row">
            <span className="grow">país (sharding key)</span>
            <strong>{resp.usuario.pais}</strong>
          </div>
          <div className="row">
            <span className="grow">Operación</span>
            <span className="ok">{resp.meta.operacion}</span>
          </div>
          <div className="row">
            <span className="grow">Shard destino</span>
            <ShardBadge shard={resp.meta.shard_destino} label={resp.meta.shard_destino} />
          </div>
          <p style={{ marginTop: 16, color: 'var(--text-dim)', fontSize: 12 }}>
            <strong>Prueba del sharing horizontal:</strong> creá un usuario <code>AR</code> y otro
            <code> MX</code> — vas a ver que caen en shards distintos. Si tuvieras más países con
            prefijos &lt; 'ES' (ej. BR, CL), también caerían en <code>shard01-rs</code>.
          </p>
        </div>
      )}
    </div>
  );
}