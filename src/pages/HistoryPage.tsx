import { useCallback, useEffect, useState } from 'react'
import type { HistoryFile, RoomItem } from '../types'

type Props = {
  sessionItems: RoomItem[]
  downloadFolder?: string
  onError: (msg: string | null) => void
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatWhen(ts: number) {
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function HistoryPage({ sessionItems, downloadFolder, onError }: Props) {
  const [files, setFiles] = useState<HistoryFile[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    onError(null)
    try {
      setFiles(await window.oncloud.listHistory())
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not read history folder')
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function openFile(filePath: string) {
    const result = await window.oncloud.openHistoryFile(filePath)
    if (!result.ok) onError(result.error || 'Open failed')
  }

  async function reveal(filePath: string) {
    const result = await window.oncloud.revealHistoryFile(filePath)
    if (!result.ok) onError(result.error || 'Reveal failed')
  }

  async function remove(filePath: string) {
    const result = await window.oncloud.deleteHistoryFile(filePath)
    if (!result.ok) {
      onError(result.error || 'Delete failed')
      return
    }
    await refresh()
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text)
  }

  return (
    <div className="mx-auto h-full max-w-4xl overflow-auto p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">History</h1>
          <p className="mt-1 text-sm text-muted">
            Nothing extra is logged. This lists files already saved on this PC by OnCloudShare, plus
            what is in the current room session.
          </p>
          {downloadFolder && (
            <p className="mt-2 font-mono text-[11px] text-muted break-all">{downloadFolder}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <button className="btn-secondary text-xs" onClick={() => void refresh()}>
            Refresh
          </button>
          <button className="btn-secondary text-xs" onClick={() => window.oncloud.openDownloadFolder()}>
            Open folder
          </button>
        </div>
      </div>

      <section className="card mb-6 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Saved on this PC</h2>
          <span className="text-xs text-muted">{files.length} file{files.length === 1 ? '' : 's'}</span>
        </div>
        {loading && <div className="py-8 text-center text-sm text-muted">Reading folder…</div>}
        {!loading && files.length === 0 && (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
            No saved files yet. When you hit Save on a shared file, it appears here.
          </div>
        )}
        {!loading && files.length > 0 && (
          <ul className="space-y-2">
            {files.map((file) => (
              <li
                key={file.path}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{file.name}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {formatBytes(file.size)} · {formatWhen(file.modifiedAt)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button className="btn-ghost text-xs" onClick={() => void openFile(file.path)}>
                    Open
                  </button>
                  <button className="btn-ghost text-xs" onClick={() => void reveal(file.path)}>
                    Show
                  </button>
                  <button className="btn-ghost text-xs text-red-300" onClick={() => void remove(file.path)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">This session (room)</h2>
          <span className="text-xs text-muted">
            {sessionItems.length} item{sessionItems.length === 1 ? '' : 's'} · clears when you leave
          </span>
        </div>
        {sessionItems.length === 0 && (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
            Join or create a room to see shared text and files here while the room is open.
          </div>
        )}
        {sessionItems.length > 0 && (
          <ul className="space-y-2">
            {[...sessionItems].reverse().map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-border bg-bg px-3 py-3"
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted">
                  <span>
                    {item.type === 'file' ? 'File' : 'Text'} · {item.fromName}
                  </span>
                  <span>{formatWhen(item.createdAt)}</span>
                </div>
                {item.type === 'text' ? (
                  <div className="flex items-start justify-between gap-3">
                    <pre className="max-h-24 flex-1 overflow-auto whitespace-pre-wrap break-words font-mono text-sm">
                      {item.text}
                    </pre>
                    <button className="btn-ghost shrink-0 text-xs text-accent" onClick={() => void copyText(item.text)}>
                      Copy
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{item.name}</div>
                      <div className="text-xs text-muted">{formatBytes(item.size)}</div>
                    </div>
                    <button
                      className="btn-secondary text-xs"
                      onClick={async () => {
                        const result = await window.oncloud.downloadFile(item.id)
                        if (!result.ok) onError(result.error || 'Save failed')
                        else await refresh()
                      }}
                    >
                      Save to PC
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
