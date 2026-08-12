import { useEffect, useMemo, useState } from 'react'
import type { AppSettings, DiscoveredRoom, FileProgress, Peer, RoomItem, ServerStatus } from './types'
import HomePage from './pages/HomePage'
import RoomPage from './pages/RoomPage'
import SettingsPage from './pages/SettingsPage'
import HistoryPage from './pages/HistoryPage'
import FirstRunModal from './components/FirstRunModal'
import Toast from './components/Toast'

type Page = 'home' | 'room' | 'history' | 'settings'

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [items, setItems] = useState<RoomItem[]>([])
  const [peers, setPeers] = useState<Peer[]>([])
  const [nearby, setNearby] = useState<DiscoveredRoom[]>([])
  const [progress, setProgress] = useState<Record<string, FileProgress>>({})
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [st, se, it] = await Promise.all([
        window.oncloud.getStatus(),
        window.oncloud.getSettings(),
        window.oncloud.getItems(),
      ])
      if (!alive) return
      setStatus(st)
      setSettings(se)
      setItems(it)
      setPeers(st.peers)
      if (st.room) setPage('room')
    })()

    const offStatus = window.oncloud.onStatus((s) => {
      setStatus(s)
      setPeers(s.peers)
      if (!s.room && page === 'room') setPage('home')
    })
    const offItems = window.oncloud.onItems(setItems)
    const offPeers = window.oncloud.onPeers(setPeers)
    const offProgress = window.oncloud.onProgress((p) => {
      setProgress((prev) => ({ ...prev, [p.fileId]: p }))
    })
    const offNotify = window.oncloud.onNotification((n) => {
      setToast(n)
      setTimeout(() => setToast(null), n.title === 'Saved' ? 6000 : 3500)
    })

    const timer = setInterval(async () => {
      try {
        const rooms = await window.oncloud.listNearby()
        setNearby(rooms)
      } catch {
        /* ignore */
      }
    }, 3000)

    return () => {
      alive = false
      offStatus()
      offItems()
      offPeers()
      offProgress()
      offNotify()
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (status?.room) setPage((p) => (p === 'home' ? 'room' : p))
  }, [status?.room])

  const connectionLabel = useMemo(() => {
    if (!status?.room) return 'Idle'
    if (status.tunnelStatus === 'active') return 'Remote tunnel'
    return 'LAN'
  }, [status])

  async function refreshSettings() {
    setSettings(await window.oncloud.getSettings())
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/20 text-accent">
            <span className="text-sm font-bold">OC</span>
          </div>
          <div>
            <div className="text-sm font-semibold tracking-wide">OnCloudShare</div>
            <div className="text-xs text-muted">Local-first sharing · {connectionLabel}</div>
          </div>
        </div>
        <nav className="flex items-center gap-1">
          <button
            className={`btn-ghost ${page === 'home' || page === 'room' ? 'text-text' : ''}`}
            onClick={() => setPage(status?.room ? 'room' : 'home')}
          >
            {status?.room ? 'Room' : 'Home'}
          </button>
          <button
            className={`btn-ghost ${page === 'history' ? 'text-text' : ''}`}
            onClick={() => setPage('history')}
          >
            History
          </button>
          <button
            className={`btn-ghost ${page === 'settings' ? 'text-text' : ''}`}
            onClick={() => setPage('settings')}
          >
            Settings
          </button>
          <div className="ml-2 flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-xs text-muted">
            <span
              className={`h-2 w-2 rounded-full ${
                status?.reconnecting
                  ? 'bg-amber-400'
                  : status?.connected
                    ? 'bg-online'
                    : 'bg-muted'
              }`}
            />
            {status?.reconnecting
              ? `Reconnecting (${status.reconnectAttempt})`
              : status?.connected
                ? 'Connected'
                : 'Offline room'}
          </div>
        </nav>
      </header>

      <main className="relative flex-1 overflow-hidden">
        {error && (
          <div className="absolute left-4 right-4 top-4 z-20 rounded-lg border border-red-900/50 bg-red-950/70 px-3 py-2 text-sm text-red-200">
            {error}
            <button className="ml-3 text-xs underline" onClick={() => setError(null)}>
              dismiss
            </button>
          </div>
        )}

        {page === 'home' && (
          <HomePage
            nearby={nearby}
            settings={settings}
            busy={busy}
            onError={setError}
            onBusy={setBusy}
            onJoined={() => setPage('room')}
          />
        )}
        {page === 'room' && status?.room && (
          <RoomPage
            status={status}
            items={items}
            peers={peers}
            progress={progress}
            downloadFolder={settings?.downloadFolder}
            busy={busy}
            onBusy={setBusy}
            onError={setError}
            onLeft={() => setPage('home')}
          />
        )}
        {page === 'history' && (
          <HistoryPage
            sessionItems={items}
            downloadFolder={settings?.downloadFolder}
            onError={setError}
          />
        )}
        {page === 'settings' && settings && (
          <SettingsPage
            settings={settings}
            status={status}
            onSaved={async (next) => {
              setSettings(next)
              await refreshSettings()
            }}
            onError={setError}
          />
        )}
      </main>

      {settings && !settings.firstRunDone && (
        <FirstRunModal
          ips={status?.localIps || []}
          port={status?.port || 47891}
          onDone={async () => {
            await window.oncloud.dismissFirstRun()
            await refreshSettings()
          }}
        />
      )}

      {toast && <Toast title={toast.title} body={toast.body} />}
    </div>
  )
}
