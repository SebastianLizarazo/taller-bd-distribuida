import axios from 'axios';

// Cliente axios apuntando al backend Express.
const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// Wrappers tipados para cada endpoint. Si el response no es ok, tira error con detalle.
async function get(path) {
  const r = await client.get(path);
  return r.data;
}
async function del(path) {
  const r = await client.delete(path);
  return r.data;
}
async function post(path, body) {
  const r = await client.post(path, body);
  return r.data;
}

export const api = {
  health: () => get('/health'),

  // Usuarios
  crearUsuario: (data) => post('/api/usuarios', data),
  listarUsuarios: ({ pais, limit = 50 } = {}) => get(`/api/usuarios${pais ? `?pais=${pais}` : ''}${limit ? `${pais ? '&' : '?'}limit=${limit}` : ''}`),
  obtenerUsuario: (id) => get(`/api/usuarios/${id}`),
  eliminarUsuario: (id) => del(`/api/usuarios/${id}`),

  // Eventos
  crearEvento: (userId, data) => post(`/api/usuarios/${userId}/eventos`, data),
  listarEventos: (userId, { tipo, limit = 50 } = {}) => {
    const q = new URLSearchParams();
    if (tipo) q.set('tipo', tipo);
    if (limit) q.set('limit', limit);
    return get(`/api/usuarios/${userId}/eventos${q.toString() ? `?${q}` : ''}`);
  },

  // Admin
  shardStatus: () => get('/api/admin/shard-status'),
  distribucion: () => get('/api/admin/distribucion'),
  dondeEsta: (userId) => get(`/api/admin/donde-esta/${userId}`),
  balance: () => get('/api/admin/balance'),
};