import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import type { FileProgress, Peer, RoomItem, ServerStatus } from '../types'
import PeerList from '../components/PeerList'
import MessageFeed from '../components/MessageFeed'
import DropZone from '../components/DropZone'
import TransferPanel from '../components/TransferPanel'

type Props = {
  status: ServerStatus
  items: RoomItem[]
  peers: Peer[]
  progress: Record<string, FileProgress>
  downloadFolder?: string
  busy: boolean
  onBusy: (v: boolean) => void
  onError: (msg: string | null) => void
  onLeft: () => void
}

export default function RoomPage({
  status,
  items,
  peers,
  progress,
  downloadFolder,
  busy,
  onBusy,
  onError,
  onLeft,
}: Props) {
  const [text, setText] = useState('')
  const [tunnelBusy, setTunnelBusy] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const room = status.room!

  async function leave() {
    onBusy(true)
    try {
      await window.oncloud.leaveRoom()
      onLeft()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Leave failed')
    } finally {
      onBusy(false)
    }
  }

  async function sendText() {
    if (!text.trim()) return
    const value = text
    setText('')
    try {
      await window.oncloud.sendText(value)
    } catch (e) {
      setText(value)
      onError(e instanceof Error ? e.message : 'Send failed')
    }
  }

  async function sendClipboard() {
    const result = await window.oncloud.sendClipboard()
    if (!result.ok) onError(result.error || 'Clipboard empty')
  }

  async function pasteTextFromEvent(value: string) {
    try {
      await window.oncloud.sendText(value)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Paste failed')
    }
  }

  async function onFiles(files: File[]) {
    onBusy(true)
    onError(null)
    try {
      for (const file of files) {
        const filePath = window.oncloud.getPathForFile(file)
        if (filePath) {
          await window.oncloud.sendFilePath(
            filePath,
            file.name,
            file.type || 'application/octet-stream',
          )
          continue
        }
        const data = await file.arrayBuffer()
        await window.oncloud.sendFileBuffer({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          data,
        })
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'File send failed')
    } finally {
      onBusy(false)
    }
  }

  async function download(fileId: string) {
    onError(null)
    const item = items.find((i) => i.id === fileId)
    // Optimistic progress so the bar appears immediately
    if (item?.type === 'file') {
      // progress comes from main; kick UI with a local hint via error-free path
    }
    const result = await window.oncloud.downloadFile(fileId)
    if (!result.ok && result.error !== 'Download cancelled') {
      onError(result.error || 'Download failed')
    }
  }

  async function openSaved(filePath: string) {
    const result = await window.oncloud.openHistoryFile(filePath)
    if (!result.ok) onError(result.error || 'Could not open file')
  }

  async function revealSaved(filePath: string) {
    const result = await window.oncloud.revealHistoryFile(filePath)
    if (!result.ok) onError(result.error || 'Could not show file')
  }

  async function pause(fileId: string) {
    await window.oncloud.pauseTransfer(fileId)
  }

  async function resume(fileId: string) {
    await window.oncloud.resumeTransfer(fileId)
  }

  async function cancel(fileId: string) {
    await window.oncloud.cancelTransfer(fileId)
  }

  async function enableTunnel() {
    setTunnelBusy(true)
    onError(null)
    try {
      const result = await window.oncloud.startTunnel()
      if (!result.ok) throw new Error(result.error || 'Tunnel failed')
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Tunnel failed')
    } finally {
      setTunnelBusy(false)
    }
  }

  async function regenerateTunnel() {
    setTunnelBusy(true)
    onError(null)
    try {
      const result = await window.oncloud.regenerateTunnel()
      if (!result.ok) throw new Error(result.error || 'Could not refresh link')
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not refresh link')
    } finally {
      setTunnelBusy(false)
    }
  }

  async function copy(textValue: string) {
    await navigator.clipboard.writeText(textValue)
  }

  const joinHint =
    status.role === 'host'
      ? `${room.localIps[0] || status.localIps[0]}:${status.port}`
      : null

  const phoneLanUrl =
    status.role === 'host'
      ? `http://${room.localIps[0] || status.localIps[0]}:${status.port}/`
      : null
  const phoneRemoteUrl =
    status.role === 'host' && status.tunnelUrl
      ? status.tunnelUrl.replace(/\/$/, '') + '/'
      : null
  const phoneUrl = phoneRemoteUrl || phoneLanUrl

  useEffect(() => {
    let cancelled = false
    if (!phoneUrl) {
      setQrDataUrl(null)
      return
    }
    void QRCode.toDataURL(phoneUrl, {
      width: 160,
      margin: 2,
      color: { dark: '#0a0a0b', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [phoneUrl])

  const remoteBusy = tunnelBusy || status.tunnelStatus === 'starting'
  const transferring = Object.values(progress).some((p) =>
    ['uploading', 'downloading', 'paused'].includes(p.status),
  )

  return (
    <div className="relative flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
        <div className="border-b border-border p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Room</div>
          <div className="mt-1 truncate text-sm font-semibold">{room.name}</div>
          <div className="mt-2 font-mono text-lg tracking-[0.2em] text-accent">{room.code}</div>
          {joinHint && (
            <div className="mt-2 font-mono text-[11px] text-muted">
              LAN · {joinHint}
              <button className="ml-2 text-accent" onClick={() => copy(joinHint)}>
                copy
              </button>
            </div>
          )}
          {status.role === 'host' && (
            <div className="mt-3 rounded-lg border border-border bg-bg px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted">Remote</div>
              {remoteBusy && (
                <div className="mt-1 text-xs text-accent">Starting share link automatically…</div>
              )}
              {status.tunnelStatus === 'active' && status.tunnelUrl && (
                <div className="mt-1">
                  <div className="break-all font-mono text-[10px] text-online">{status.tunnelUrl}</div>
                  <p className="mt-1 text-[10px] leading-snug text-muted">
                    Free link lasts until this app stops. Remote PCs need the latest link.
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <button className="text-xs text-accent" onClick={() => copy(status.tunnelUrl!)}>
                      Copy link
                    </button>
                    <button className="text-xs text-accent" disabled={remoteBusy} onClick={regenerateTunnel}>
                      Regenerate
                    </button>
                  </div>
                </div>
              )}
              {(status.tunnelStatus === 'error' || status.tunnelStatus === 'expired') && (
                <div className="mt-1 text-xs text-red-300">
                  {status.tunnelError ||
                    (status.tunnelStatus === 'expired' ? 'Remote link expired' : 'Remote link failed')}
                  <button
                    className="ml-2 text-accent"
                    disabled={remoteBusy}
                    onClick={status.tunnelStatus === 'expired' ? regenerateTunnel : enableTunnel}
                  >
                    {status.tunnelStatus === 'expired' ? 'New link' : 'Retry'}
                  </button>
                </div>
              )}
              {status.tunnelStatus === 'idle' && !remoteBusy && (
                <div className="mt-1 text-xs text-muted">
                  LAN only
                  <button className="ml-2 text-accent" disabled={remoteBusy} onClick={enableTunnel}>
                    Get remote link
                  </button>
                </div>
              )}
            </div>
          )}
          {status.role === 'host' && phoneUrl && (
            <div className="mt-3 rounded-lg border border-border bg-bg px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted">Phone join</div>
              <p className="mt-1 text-[11px] leading-snug text-muted">
                Open this link on iPhone/Android browser — no app install.
              </p>
              <div className="mt-2 flex justify-center rounded-lg bg-white p-2">
                {qrDataUrl ? (
                  <img
                    alt="QR code for phone join"
                    width={128}
                    height={128}
                    className="h-32 w-32"
                    src={qrDataUrl}
                  />
                ) : (
                  <div className="flex h-32 w-32 items-center justify-center text-center text-[11px] text-zinc-500">
                    Generating QR…
                  </div>
                )}
              </div>
              <div className="mt-2 break-all font-mono text-[10px] text-accent">{phoneUrl}</div>
              <div className="mt-1 flex flex-wrap gap-2">
                <button className="text-xs text-accent" onClick={() => copy(phoneUrl)}>
                  Copy phone link
                </button>
                {phoneLanUrl && phoneRemoteUrl && phoneLanUrl !== phoneRemoteUrl && (
                  <button className="text-xs text-muted" onClick={() => copy(phoneLanUrl)}>
                    Copy LAN link
                  </button>
                )}
              </div>
            </div>
          )}
          {status.reconnecting && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-200">
              <span className="transfer-spinner-sm" />
              Reconnecting… attempt {status.reconnectAttempt}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-auto p-3">
          <PeerList peers={peers} />
        </div>
        <div className="space-y-2 border-t border-border p-3">
          {status.role === 'host' && (status.tunnelStatus === 'active' || status.tunnelStatus === 'expired') && (
            <button className="btn-ghost w-full text-xs" disabled={remoteBusy} onClick={regenerateTunnel}>
              {remoteBusy ? 'Refreshing link…' : 'Regenerate remote link'}
            </button>
          )}
          {status.role === 'host' && status.tunnelStatus === 'active' && (
            <button className="btn-ghost w-full text-xs" onClick={() => window.oncloud.stopTunnel()}>
              Stop remote link
            </button>
          )}
          <button className="btn-danger w-full" disabled={busy} onClick={leave}>
            Leave room
          </button>
        </div>
      </aside>

      <section className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-muted">
          <span className="flex items-center gap-2">
            {status.role === 'host' ? 'Hosting' : 'Joined'} · {peers.length} peer
            {peers.length === 1 ? '' : 's'}
            {transferring && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-accent">
                <span className="transfer-spinner-sm" />
                Transferring
              </span>
            )}
          </span>
          <div className="flex gap-2">
            <button className="btn-ghost text-xs" onClick={sendClipboard}>
              Paste clipboard
            </button>
            <button className="btn-ghost text-xs" onClick={() => window.oncloud.openDownloadFolder()}>
              Open downloads
            </button>
          </div>
        </div>

        <MessageFeed
          items={items}
          progress={progress}
          downloadFolder={downloadFolder}
          onDownload={download}
          onCopy={copy}
          onPause={pause}
          onResume={resume}
          onCancel={cancel}
          onOpenSaved={openSaved}
          onRevealSaved={revealSaved}
        />

        <div className="border-t border-border p-4">
          <DropZone
            disabled={busy || transferring}
            onFiles={onFiles}
            onPasteText={(value) => void pasteTextFromEvent(value)}
            onPasteClipboard={() => void sendClipboard()}
          />
          {busy && (
            <div className="mt-2 flex items-center gap-2 text-xs text-accent">
              <span className="transfer-spinner-sm" />
              Preparing file transfer…
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <textarea
              ref={inputRef}
              className="input min-h-[72px] resize-none"
              placeholder="Paste passwords, notes, links… Enter to send, Shift+Enter for newline"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData?.files || [])
                if (files.length) {
                  e.preventDefault()
                  void onFiles(files)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void sendText()
                }
              }}
            />
            <button className="btn-primary self-end px-5" onClick={sendText} disabled={!text.trim()}>
              Send
            </button>
          </div>
        </div>

        <TransferPanel progress={progress} onPause={pause} onResume={resume} onCancel={cancel} />
      </section>
    </div>
  )
}
