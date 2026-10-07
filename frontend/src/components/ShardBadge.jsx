// Badge visual de shard. Tres variantes:
// - "shard1" (amarillo) → shard01-rs
// - "shard2" (azul) → shard02-rs
// - "both" (violeta) → scatter-gather
export default function ShardBadge({ shard, label }) {
  if (!shard) return null;
  const variant = shard.includes('shard01-rs') && shard.includes('shard02-rs') ? 'both'
                 : shard.startsWith('shard01-rs') ? 'shard1'
                 : 'shard2';
  return <span className={`shard-badge ${variant}`}>{label || shard}</span>;
}