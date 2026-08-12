import { useEffect, useState } from 'react'
import type { FileProgress } from '../types'

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function statusLabel(p: FileProgress) {
  if (p.status === 'uploading') return 'Uploading'
  if (p.status === 'downloading') return 'Saving…'
  if (p.status === 'paused') return 'Paused'
  if (p.status === 'error') return p.error || 'Error'
  return p.status
}

type Props = {
  progress: Record<string, FileProgress>
  onPause: (fileId: string) => void
  onResume: (fileId: string) => void
  onCancel: (fileId: string) => void
}

export default function TransferPanel({ progress, onPause, onResume, onCancel }: Props) {
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({})

  const active = Object.values(progress).filter(
    (p) =>
      !dismissed[p.fileId] &&
      ['uploading', 'downloading', 'paused', 'error'].includes(p.status),
  )

  // Auto-hide shortly after a transfer finishes successfully
  useEffect(() => {
    const timers: number[] = []
    for (const p of Object.values(progress)) {
      if (p.status === 'done' && !dismissed[p.fileId]) {
        const t = window.setTimeout(() => {
          setDismissed((prev) => ({ ...prev, [p.fileId]: true }))
        }, 1200)
        timers.push(t)
      }
    }
    return () => timers.forEach((t) => clearTimeout(t))
  }, [progress, dismissed])

  if (active.length === 0) return null

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 right-4 z-30 mx-auto max-w-xl">
      <div className="card border-accent/30 bg-surface/95 p-3 shadow-2xl backdrop-blur">
        <div className="mb-2 flex items-center gap-2">
          <span className="transfer-spinner" aria-hidden />
          <div className="text-sm font-medium">File transfers</div>
          <div className="text-xs text-muted">{active.length} active</div>
        </div>
        <ul className="space-y-3">
          {active.map((p) => {
            const pct = p.total ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0
            const isActive = p.status === 'uploading' || p.status === 'downloading'
            return (
              <li key={p.fileId} className="rounded-lg border border-border bg-bg px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                      {isActive && <span className="transfer-spinner-sm" />}
                      <span
                        className={
                          p.status === 'paused'
                            ? 'text-amber-300'
                            : p.status === 'error'
                              ? 'text-red-300'
                              : 'text-accent'
                        }
                      >
                        {statusLabel(p)}
                      </span>
                      <span>
                        {formatBytes(p.received)} / {formatBytes(p.total)} · {pct}%
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {p.status === 'paused' ? (
                      <button
                        className="btn-secondary px-2 py-1 text-xs"
                        onClick={() => onResume(p.fileId)}
                      >
                        Resume
                      </button>
                    ) : isActive ? (
                      <button
                        className="btn-secondary px-2 py-1 text-xs"
                        onClick={() => onPause(p.fileId)}
                      >
                        Pause
                      </button>
                    ) : null}
                    {(isActive || p.status === 'paused' || p.status === 'error') && (
                      <button
                        className="btn-ghost px-2 py-1 text-xs text-red-300"
                        onClick={() => onCancel(p.fileId)}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
                  <div
                    className={`h-full rounded-full transition-all ${
                      p.status === 'paused'
                        ? 'bg-amber-400'
                        : p.status === 'error'
                          ? 'bg-red-400'
                          : 'bg-accent'
                    } ${isActive ? 'transfer-bar-pulse' : ''}`}
                    style={{ width: `${Math.max(pct, 4)}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
