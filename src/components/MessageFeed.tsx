import type { FileProgress, RoomItem } from '../types'

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function time(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

type Props = {
  items: RoomItem[]
  progress: Record<string, FileProgress>
  downloadFolder?: string
  onDownload: (id: string) => void
  onCopy: (text: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onCancel: (id: string) => void
  onOpenSaved?: (path: string) => void
  onRevealSaved?: (path: string) => void
}

export default function MessageFeed({
  items,
  progress,
  downloadFolder,
  onDownload,
  onCopy,
  onPause,
  onResume,
  onCancel,
  onOpenSaved,
  onRevealSaved,
}: Props) {
  return (
    <div className="flex-1 space-y-3 overflow-auto px-4 py-4 pb-36">
      {items.length === 0 && (
        <div className="flex h-full min-h-[200px] items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted">
          Drop files or paste text to share with this room.
        </div>
      )}
      {[...items].reverse().map((item) => {
        const p = progress[item.id]
        const transferring =
          p &&
          (p.status === 'uploading' ||
            p.status === 'downloading' ||
            p.status === 'paused')
        const justSaved = p?.status === 'done' && p.direction === 'download'
        const pct = p && p.total ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0
        const savedPath = item.type === 'file' ? item.path : undefined

        return (
          <article key={item.id} className="card p-3">
            <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted">
              <span className="min-w-0 truncate">{item.fromName}</span>
              <span>{time(item.createdAt)}</span>
            </div>
            {item.type === 'text' ? (
              <div>
                <pre className="whitespace-pre-wrap break-words font-mono text-sm text-text">
                  {item.text}
                </pre>
                <button
                  className="btn-ghost mt-2 px-0 text-xs text-accent"
                  onClick={() => onCopy(item.text)}
                >
                  Copy
                </button>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {transferring && <span className="transfer-spinner-sm" />}
                      <span className="truncate">{item.name}</span>
                    </div>
                    <div className="text-xs text-muted">{formatBytes(item.size)}</div>
                  </div>
                  {transferring ? (
                    <div className="flex gap-1">
                      {p.status === 'paused' ? (
                        <button className="btn-secondary text-xs" onClick={() => onResume(item.id)}>
                          Resume
                        </button>
                      ) : (
                        <button className="btn-secondary text-xs" onClick={() => onPause(item.id)}>
                          Pause
                        </button>
                      )}
                      <button
                        className="btn-ghost text-xs text-red-300"
                        onClick={() => onCancel(item.id)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : savedPath ? (
                    <div className="flex gap-1">
                      <button
                        className="btn-secondary text-xs"
                        onClick={() => onOpenSaved?.(savedPath)}
                      >
                        Open
                      </button>
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => onDownload(item.id)}
                      >
                        Save again
                      </button>
                    </div>
                  ) : (
                    <button className="btn-secondary text-xs" onClick={() => onDownload(item.id)}>
                      Save
                    </button>
                  )}
                </div>

                {transferring && p && (
                  <div className="mt-2">
                    <div className="mb-1 flex justify-between gap-2 text-[11px] text-muted">
                      <span>
                        {p.status === 'paused'
                          ? 'Paused'
                          : p.direction === 'upload'
                            ? 'Uploading…'
                            : 'Saving to disk…'}
                      </span>
                      <span>
                        {formatBytes(p.received)} / {formatBytes(p.total)} · {pct}%
                      </span>
                    </div>
                    {p.direction === 'download' && downloadFolder && (
                      <div className="mb-1 truncate font-mono text-[10px] text-muted">
                        {downloadFolder}
                      </div>
                    )}
                    <div className="h-1.5 overflow-hidden rounded-full bg-border">
                      <div
                        className={`h-full rounded-full ${
                          p.status === 'paused'
                            ? 'bg-amber-400'
                            : 'bg-accent transfer-bar-pulse'
                        }`}
                        style={{ width: `${Math.max(pct, 4)}%` }}
                      />
                    </div>
                  </div>
                )}

                {(justSaved || savedPath) && !transferring && (
                  <div className="mt-2 rounded-lg border border-online/30 bg-online/10 px-2.5 py-2">
                    <div className="text-[11px] font-medium text-online">
                      {justSaved ? 'Saved' : 'Already saved'}
                    </div>
                    <div className="mt-0.5 break-all font-mono text-[10px] text-muted">
                      {savedPath || downloadFolder}
                    </div>
                    {savedPath && (
                      <div className="mt-1 flex gap-3">
                        <button
                          className="text-[11px] text-accent"
                          onClick={() => onOpenSaved?.(savedPath)}
                        >
                          Open file
                        </button>
                        <button
                          className="text-[11px] text-accent"
                          onClick={() => onRevealSaved?.(savedPath)}
                        >
                          Show in folder
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
