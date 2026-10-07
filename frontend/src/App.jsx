import { Routes, Route, NavLink } from 'react-router-dom';
import Home from './pages/Home.jsx';
import CrearUsuario from './pages/CrearUsuario.jsx';
import ListarUsuarios from './pages/ListarUsuarios.jsx';
import PerfilCompleto from './pages/PerfilCompleto.jsx';
import DashboardShards from './pages/DashboardShards.jsx';

export default function App() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>
          Sharding MongoDB
          <small>Taller universitario</small>
        </h1>
        <nav>
          <NavLink to="/" end>Inicio</NavLink>
          <NavLink to="/crear">Crear usuario</NavLink>
          <NavLink to="/usuarios">Listar usuarios</NavLink>
          <NavLink to="/shards">Dashboard de shards</NavLink>
        </nav>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/crear" element={<CrearUsuario />} />
          <Route path="/usuarios" element={<ListarUsuarios />} />
          <Route path="/usuarios/:id" element={<PerfilCompleto />} />
          <Route path="/shards" element={<DashboardShards />} />
        </Routes>
      </main>
    </div>
  );
}