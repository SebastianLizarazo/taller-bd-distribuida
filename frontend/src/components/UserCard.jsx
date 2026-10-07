import { Link } from 'react-router-dom';
import ShardBadge from './ShardBadge.jsx';

// Card de un usuario, mostrando a qué shard pertenece según el filtro que se aplicó.
export default function UserCard({ usuario, shardForQuery }) {
  // Si sabemos el shard del query, ese manda. Si no, inferimos por el pais del usuario.
  const shard = shardForQuery || (usuario.pais < 'ES' ? 'shard01-rs' : 'shard02-rs');
  const targeted = shardForQuery !== undefined && shardForQuery !== 'shard01-rs + shard02-rs';

  return (
    <tr>
      <td>
        <Link to={`/usuarios/${usuario._id}`}>{usuario._id}</Link>
      </td>
      <td>{usuario.nombre}</td>
      <td>{usuario.email}</td>
      <td>
        <span style={{ fontWeight: 700, color: usuario.pais === 'AR' || usuario.pais === 'CO' ? 'var(--shard1)' : 'var(--shard2)' }}>
          {usuario.pais}
        </span>
      </td>
      <td>
        <ShardBadge shard={shard} label={targeted ? 'targeted' : 'scatter'} />
      </td>
    </tr>
  );
}