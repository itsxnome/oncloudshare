import { useEffect, useState } from 'react'
import type { AppSettings, ServerStatus, TunnelDetectResult } from '../types'

type Props = {
  settings: AppSettings
  status: ServerStatus | null
  onSaved: (next: AppSettings) => void | Promise<void>
  onError: (msg: string | null) => void
}

export default function SettingsPage({ settings, status, onSaved, onError }: Props) {
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [tunnelInfo, setTunnelInfo] = useState<TunnelDetectResult | null>(null)
  const [setupBusy, setSetupBusy] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    setForm(settings)
  }, [settings])

  useEffect(() => {
    void window.oncloud.detectTunnel().then(setTunnelInfo)
  }, [])

  async function savePartial(partial: Partial<AppSettings>) {
    const nextForm = { ...form, ...partial }
    setForm(nextForm)
    const next = await window.oncloud.saveSettings(partial)
    await onSaved(next)
    return next
  }

  async function save() {
    setSaving(true)
    onError(null)
    try {
      const next = await window.oncloud.saveSettings(form)
      await onSaved(next)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function pickFolder() {
    const folder = await window.oncloud.pickDownloadFolder()
    if (folder) {
      await savePartial({ downloadFolder: folder })
    }
  }

  async function ensureHelper() {
    setSetupBusy(true)
    onError(null)
    try {
      const result = await window.oncloud.ensureTunnel()
      setTunnelInfo(result)
      if (!result.ready) {
        onError(result.error || 'Could not set up remote helper automatically')
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Setup failed')
    } finally {
      setSetupBusy(false)
    }
  }

  const helperLabel = tunnelInfo?.ready
    ? `Ready · auto-detected (${tunnelInfo.source})`
    : setupBusy || tunnelInfo?.installing
      ? 'Downloading Cloudflare helper…'
      : 'Not found yet — will auto-download when you create a room'

  return (
    <div className="mx-auto h-full max-w-3xl overflow-auto p-6">
      <h1 className="mb-1 text-xl font-semibold">Settings</h1>
      <p className="mb-6 text-sm text-muted">
        Prefer automatic. OnCloudShare detects your network and remote helper for you.
      </p>

      <div className="space-y-5">
        <section className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold">Identity</h2>
          <div>
            <label className="label">Display name</label>
            <input
              className="input"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Default room PIN</label>
            <input
              className="input font-mono"
              value={form.pin}
              onChange={(e) => setForm({ ...form, pin: e.target.value })}
              placeholder="Optional"
            />
          </div>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold">Downloads</h2>
          <div>
            <label className="label">Save files to</label>
            <div className="flex gap-2">
              <input className="input font-mono text-xs" value={form.downloadFolder} readOnly />
              <button className="btn-secondary shrink-0" onClick={pickFolder}>
                Change
              </button>
            </div>
          </div>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold">Transfers</h2>
          <div>
            <label className="label">Max file size (MB)</label>
            <input
              className="input font-mono"
              type="number"
              min={0}
              max={20480}
              value={form.maxFileSizeMb ?? 0}
              onChange={(e) =>
                setForm({ ...form, maxFileSizeMb: Math.max(0, Number(e.target.value) || 0) })
              }
              onBlur={() => void savePartial({ maxFileSizeMb: form.maxFileSizeMb })}
            />
            <p className="mt-1 text-xs text-muted">
              Use 0 for unlimited (default). Set a positive value to enforce a room limit.
            </p>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.e2eEncryption}
              onChange={(e) => void savePartial({ e2eEncryption: e.target.checked })}
            />
            <span>
              <span className="font-medium">Experimental chunk encryption</span>
              <span className="mt-0.5 block text-xs text-muted">
                Requires a room PIN and matching support on both peers.
              </span>
            </span>
          </label>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold">Remote access</h2>
          <p className="text-xs leading-relaxed text-muted">
            When you create a room, OnCloudShare automatically opens a free Cloudflare link so a PC
            outside your Wi‑Fi can join. No manual URL or path needed.
          </p>

          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.autoRemoteOnCreate !== false}
              onChange={(e) => void savePartial({ autoRemoteOnCreate: e.target.checked })}
            />
            <span>
              <span className="font-medium">Auto-enable remote link when I create a room</span>
              <span className="mt-0.5 block text-xs text-muted">
                Turns on by default. Same-network peers still use fast LAN discovery.
              </span>
            </span>
          </label>

          <div className="rounded-lg border border-border bg-bg px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted">Helper status</div>
                <div className={`mt-1 text-sm ${tunnelInfo?.ready ? 'text-online' : 'text-muted'}`}>
                  {helperLabel}
                </div>
              </div>
              {!tunnelInfo?.ready && (
                <button className="btn-secondary text-xs" disabled={setupBusy} onClick={ensureHelper}>
                  {setupBusy ? 'Setting up…' : 'Set up now'}
                </button>
              )}
            </div>
            {status?.tunnelUrl && (
              <div className="mt-3 break-all font-mono text-[11px] text-online">{status.tunnelUrl}</div>
            )}
            {status?.tunnelStatus === 'error' && status.tunnelError && (
              <div className="mt-2 text-xs text-red-300">{status.tunnelError}</div>
            )}
          </div>

          <button
            className="btn-ghost px-0 text-xs text-muted"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? 'Hide advanced' : 'Show advanced (optional)'}
          </button>

          {showAdvanced && (
            <div className="space-y-3 rounded-lg border border-dashed border-border p-3">
              <p className="text-xs text-muted">
                Only if you already run your own ngrok/cloudflared tunnel elsewhere.
              </p>
              <input
                className="input font-mono text-xs"
                value={form.manualTunnelUrl}
                onChange={(e) => setForm({ ...form, manualTunnelUrl: e.target.value })}
                placeholder="Paste existing public URL"
                onBlur={() => {
                  void window.oncloud.setManualTunnel(form.manualTunnelUrl)
                  void savePartial({
                    manualTunnelUrl: form.manualTunnelUrl,
                    tunnelMode: form.manualTunnelUrl.trim() ? 'manual' : 'none',
                  })
                }}
              />
              <p className="text-xs text-muted">
                Listening on port {status?.port || form.preferredPort} ·{' '}
                {(status?.localIps || []).join(', ') || 'detecting IP…'}
              </p>
            </div>
          )}
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold">System</h2>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={form.startOnBoot}
              onChange={(e) => void savePartial({ startOnBoot: e.target.checked })}
            />
            Start OnCloudShare when Windows starts
          </label>
          <div className="rounded-lg border border-border bg-bg p-3 text-xs leading-relaxed text-muted">
            Windows may ask once to allow OnCloudShare on private networks — accept that so LAN
            discovery works. Ports 47891–47899.
          </div>
        </section>

        <button className="btn-primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save name & PIN'}
        </button>
      </div>
    </div>
  )
}
