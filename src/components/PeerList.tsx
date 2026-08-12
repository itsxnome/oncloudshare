import type { Peer } from '../types'

export default function PeerList({ peers }: { peers: Peer[] }) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Online</div>
      <ul className="space-y-1.5">
        {peers.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-2 rounded-lg border border-border/60 bg-bg px-2.5 py-2"
          >
            <span className="h-2 w-2 rounded-full bg-online" />
            <span className="truncate text-sm">{p.name}</span>
          </li>
        ))}
        {peers.length === 0 && (
          <li className="px-1 py-4 text-center text-xs text-muted">Waiting for peers…</li>
        )}
      </ul>
    </div>
  )
}
