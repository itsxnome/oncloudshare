import { useEffect, useState } from 'react'
import type { AppSettings, DiscoveredRoom } from '../types'

type Props = {
  nearby: DiscoveredRoom[]
  settings: AppSettings | null
  busy: boolean
  onBusy: (v: boolean) => void
  onError: (msg: string | null) => void
  onJoined: () => void
}

function parseSmartJoin(raw: string): {
  tunnelUrl?: string
  code?: string
  host?: string
  port?: number
} {
  const value = raw.trim()
  if (!value) return {}

  if (/^https?:\/\//i.test(value) || /^wss?:\/\//i.test(value) || /\.trycloudflare\.com/i.test(value) || /\.ngrok/i.test(value)) {
    return { tunnelUrl: value }
  }

  const ipPort = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})$/)
  if (ipPort) {
    return { host: ipPort[1], port: Number(ipPort[2]) }
  }

  if (/^[A-Za-z0-9]{4,8}$/.test(value)) {
    return { code: value.toUpperCase() }
  }

  return { code: value.toUpperCase() }
}

export default function HomePage({ nearby, settings, busy, onBusy, onError, onJoined }: Props) {
  const [tab, setTab] = useState<'create' | 'join'>('create')
  const [roomName, setRoomName] = useState('Share Room')
  const [pin, setPin] = useState(settings?.pin || '')
  const [smart, setSmart] = useState('')

  useEffect(() => {
    if (settings?.pin) setPin(settings.pin)
  }, [settings?.pin])

  async function create() {
    onBusy(true)
    onError(null)
    try {
      const result = await window.oncloud.createRoom(roomName, pin || undefined)
      if (!result.ok) throw new Error(result.error || 'Failed to create room')
      onJoined()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to create room')
    } finally {
      onBusy(false)
    }
  }

  async function joinNearby(room: DiscoveredRoom) {
    onBusy(true)
    onError(null)
    try {
      const result = await window.oncloud.joinRoom({
        code: room.code,
        host: room.host,
        port: room.port,
        pin: pin || undefined,
      })
      if (!result.ok) throw new Error(result.error || 'Join failed')
      onJoined()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Join failed')
    } finally {
      onBusy(false)
    }
  }

  async function joinSmart() {
    onBusy(true)
    onError(null)
    try {
      const parsed = parseSmartJoin(smart)
      if (!parsed.tunnelUrl && !parsed.code && !parsed.host) {
        throw new Error('Paste a room code, LAN IP:port, or remote share link')
      }
      const result = await window.oncloud.joinRoom({
        ...parsed,
        pin: pin || undefined,
      })
      if (!result.ok) throw new Error(result.error || 'Join failed')
      onJoined()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Join failed')
    } finally {
      onBusy(false)
    }
  }

  async function pasteAndJoin() {
    try {
      const clip = await navigator.clipboard.readText()
      if (!clip.trim()) {
        onError('Clipboard is empty')
        return
      }
      setSmart(clip.trim())
      onBusy(true)
      onError(null)
      const parsed = parseSmartJoin(clip)
      const result = await window.oncloud.joinRoom({
        ...parsed,
        pin: pin || undefined,
      })
      if (!result.ok) throw new Error(result.error || 'Join failed')
      onJoined()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Paste & join failed')
    } finally {
      onBusy(false)
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-6 overflow-auto p-6">
      <section className="card p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Share without the cloud headache</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          Create a room — LAN peers show up automatically, and a remote link is created for you.
          On the other PC, paste a code or link. No accounts, no Discord, no WhatsApp.
        </p>
        <div className="mt-5 flex gap-2">
          <button className={tab === 'create' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('create')}>
            Create room
          </button>
          <button className={tab === 'join' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('join')}>
            Join
          </button>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          {tab === 'create' && (
            <div className="space-y-4">
              <div>
                <label className="label">Room name</label>
                <input
                  className="input"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="Office Desk"
                />
              </div>
              <div>
                <label className="label">Optional PIN</label>
                <input
                  className="input font-mono"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="••••"
                />
              </div>
              <p className="text-xs text-muted">
                Remote share link starts automatically after create (you can turn that off in Settings).
              </p>
              <button className="btn-primary w-full" disabled={busy} onClick={create}>
                {busy ? 'Creating…' : 'Create room'}
              </button>
            </div>
          )}

          {tab === 'join' && (
            <div className="space-y-4">
              <div>
                <label className="label">Paste code or link</label>
                <input
                  className="input font-mono text-sm"
                  value={smart}
                  onChange={(e) => setSmart(e.target.value)}
                  placeholder="ABC123  ·  192.168.1.20:47891  ·  https://….trycloudflare.com"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void joinSmart()
                  }}
                />
                <p className="mt-1 text-xs text-muted">
                  Detects room code, LAN address, or remote tunnel URL automatically.
                </p>
              </div>
              <div>
                <label className="label">PIN (only if the host set one)</label>
                <input
                  className="input font-mono"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn-primary" disabled={busy || !smart.trim()} onClick={joinSmart}>
                  {busy ? 'Joining…' : 'Join'}
                </button>
                <button className="btn-secondary" disabled={busy} onClick={pasteAndJoin}>
                  Paste & join
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="card flex flex-col p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Nearby on LAN</h2>
            <span className="text-xs text-muted">{nearby.length} found · auto</span>
          </div>
          <div className="flex-1 space-y-2 overflow-auto">
            {nearby.length === 0 && (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
                Watching your network… Rooms on the same Wi‑Fi appear here automatically.
              </div>
            )}
            {nearby.map((room) => (
              <button
                key={`${room.code}-${room.host}-${room.port}`}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-bg px-3 py-3 text-left hover:border-accent/40"
                disabled={busy}
                onClick={() => joinNearby(room)}
              >
                <div>
                  <div className="text-sm font-medium">{room.name}</div>
                  <div className="font-mono text-xs text-muted">
                    {room.code} · {room.host}:{room.port}
                  </div>
                </div>
                <span className="text-xs text-accent">Join</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
