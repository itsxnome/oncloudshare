import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  clipboard,
  dialog,
  shell,
  Notification,
  globalShortcut,
} from 'electron'
import path from 'path'
import fs from 'fs'
import { createSettingsStore } from './settings'
import { ShareServer, getLocalIps } from './server/share-server'
import { TunnelManager } from './tunnel'
import { ensureDir } from './server/file-transfer'
import type {
  AppSettings,
  ServerStatus,
  RoomItem,
  Peer,
  FileProgress,
} from './shared/types'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

const settings = createSettingsStore()
const tunnel = new TunnelManager()
let share: ShareServer

function send(channel: string, payload: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, '../resources/icon.png')
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0b',
    title: 'OnCloudShare',
    show: false,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
}

function trayIcon() {
  const pngPath = path.join(__dirname, '../resources/icon.png')
  if (fs.existsSync(pngPath)) {
    return nativeImage.createFromPath(pngPath)
  }
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
      <rect width="64" height="64" rx="14" fill="#141416"/>
      <circle cx="32" cy="32" r="14" fill="#3b82f6"/>
      <circle cx="32" cy="32" r="6" fill="#0a0a0b"/>
    </svg>`
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
  )
}

function buildTrayMenu() {
  const status = share.getStatus()
  const roomLabel = status.room
    ? `Room ${status.room.code} (${status.role})`
    : 'No active room'
  return Menu.buildFromTemplate([
    { label: 'OnCloudShare', enabled: false },
    { label: roomLabel, enabled: false },
    { type: 'separator' },
    {
      label: 'Show Window',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      },
    },
    { label: 'Paste Clipboard (text/image)', click: () => void sendClipboard(), enabled: Boolean(status.room) },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        quitting = true
        app.quit()
      },
    },
  ])
}

function createTray() {
  tray = new Tray(trayIcon())
  tray.setToolTip('OnCloudShare')
  tray.setContextMenu(buildTrayMenu())
  tray.on('double-click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

function refreshTray() {
  tray?.setContextMenu(buildTrayMenu())
  const status = share.getStatus()
  if (status.room) {
    tray?.setToolTip(`OnCloudShare · ${status.room.code}`)
  } else {
    tray?.setToolTip('OnCloudShare')
  }
}

function notify(title: string, body: string) {
  send('notification', { title, body })
  if (Notification.isSupported()) {
    new Notification({ title, body }).show()
  }
}

async function sendClipboard() {
  try {
    const image = clipboard.readImage()
    if (image && !image.isEmpty()) {
      const png = image.toPNG()
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      await share.sendFileFromBuffer(`clipboard-${stamp}.png`, 'image/png', png)
      notify('Clipboard image sent', 'Shared image to the current room')
      return { ok: true as const }
    }
    const text = clipboard.readText()
    if (!text.trim()) {
      return { ok: false as const, error: 'Clipboard is empty (no text or image)' }
    }
    await share.sendText(text)
    notify('Clipboard sent', 'Shared text to the current room')
    return { ok: true as const }
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'Send failed' }
  }
}

function applyStartOnBoot(enabled: boolean) {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
    })
  } catch {
    /* ignore on unsupported platforms */
  }
}

function isInsideDownloadFolder(filePath: string, folder: string) {
  const root = path.resolve(folder)
  const target = path.resolve(filePath)
  const rel = path.relative(root, target)
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function registerIpc() {
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:save', (_e, partial: Partial<AppSettings>) => {
    const next = settings.set(partial)
    ensureDir(next.downloadFolder)
    applyStartOnBoot(next.startOnBoot)
    return next
  })
  ipcMain.handle('status:get', () => share.getStatus())
  ipcMain.handle('room:create', async (_e, name: string, pin?: string) => {
    const s = settings.get()
    const result = await share.createRoom(name, pin ?? s.pin)
    refreshTray()
    if (result.ok && s.autoRemoteOnCreate !== false) {
      // Fire-and-forget: UI watches tunnel status
      void (async () => {
        share.setTunnelState('starting', null)
        const tunnelResult = await tunnel.startQuickTunnel(
          share.getStatus().port,
          settings.get().cloudflaredPath || undefined,
        )
        if (tunnelResult.ok && tunnelResult.url) {
          share.setTunnelState('active', tunnelResult.url)
          settings.set({ tunnelMode: 'cloudflare', manualTunnelUrl: tunnelResult.url })
          notify('Remote ready', 'Share link is ready to copy from the room panel')
        } else {
          share.setTunnelState('error', null, tunnelResult.error)
        }
        refreshTray()
      })()
    }
    return result
  })
  ipcMain.handle(
    'room:join',
    async (
      _e,
      opts: { code?: string; host?: string; port?: number; pin?: string; tunnelUrl?: string },
    ) => {
      const result = await share.joinRoom(opts)
      refreshTray()
      return result
    },
  )
  ipcMain.handle('room:leave', async () => {
    await share.leaveRoom()
    await tunnel.stop()
    share.setTunnelState('idle', null)
    refreshTray()
  })
  ipcMain.handle('room:sendText', async (_e, text: string) => {
    await share.sendText(text)
  })
  ipcMain.handle('room:sendClipboard', () => sendClipboard())
  ipcMain.handle('room:items', () => share.getItems())
  ipcMain.handle('discovery:list', () => share.listNearby())
  ipcMain.handle('tunnel:start', async () => {
    const s = settings.get()
    const status = share.getStatus()
    if (!status.room || status.role !== 'host') {
      return { ok: false, error: 'Create a room as host before enabling remote access.' }
    }
    share.setTunnelState('starting', null)
    const result = await tunnel.startQuickTunnel(status.port, s.cloudflaredPath || undefined)
    if (result.ok && result.url) {
      share.setTunnelState('active', result.url)
      settings.set({ tunnelMode: 'cloudflare', manualTunnelUrl: result.url })
    } else {
      share.setTunnelState('error', null, result.error)
    }
    refreshTray()
    return result
  })
  ipcMain.handle('tunnel:regenerate', async () => {
    await tunnel.stop()
    share.setTunnelState('starting', null, undefined)
    const s = settings.get()
    const status = share.getStatus()
    if (!status.room || status.role !== 'host') {
      share.setTunnelState('idle', null)
      return { ok: false, error: 'Host a room first.' }
    }
    const result = await tunnel.startQuickTunnel(status.port, s.cloudflaredPath || undefined)
    if (result.ok && result.url) {
      share.setTunnelState('active', result.url)
      settings.set({ tunnelMode: 'cloudflare', manualTunnelUrl: result.url })
      notify('Remote link refreshed', 'Copy the new link for remote PCs')
    } else {
      share.setTunnelState('error', null, result.error)
    }
    refreshTray()
    return result
  })
  ipcMain.handle('tunnel:stop', async () => {
    await tunnel.stop()
    share.setTunnelState('idle', null)
    refreshTray()
  })
  ipcMain.handle('tunnel:detect', () => tunnel.detect(settings.get().cloudflaredPath || undefined))
  ipcMain.handle('tunnel:ensure', async () => {
    return tunnel.ensureInstalled(settings.get().cloudflaredPath || undefined)
  })
  ipcMain.handle('tunnel:manual', async (_e, url: string) => {
    const cleaned = url.trim().replace(/\/$/, '')
    settings.set({ tunnelMode: cleaned ? 'manual' : 'none', manualTunnelUrl: cleaned })
    if (cleaned) {
      share.setTunnelState('active', cleaned)
    } else {
      share.setTunnelState('idle', null)
    }
    refreshTray()
  })
  ipcMain.handle('files:download', async (_e, fileId: string) => {
    return share.downloadFile(fileId)
  })
  ipcMain.handle('transfer:pause', (_e, fileId: string) => share.pauseTransfer(fileId))
  ipcMain.handle('transfer:resume', (_e, fileId: string) => share.resumeTransfer(fileId))
  ipcMain.handle('transfer:cancel', (_e, fileId: string) => share.cancelTransfer(fileId))
  ipcMain.handle('transfer:list', () => share.listTransfers())
  ipcMain.handle('files:sendPath', async (_e, filePath: string) => {
    const buf = fs.readFileSync(filePath)
    const name = path.basename(filePath)
    await share.sendFileFromBuffer(name, 'application/octet-stream', buf)
  })
  ipcMain.handle('files:sendBuffer', async (_e, payload: { name: string; mimeType: string; data: ArrayBuffer }) => {
    const buf = Buffer.from(payload.data)
    await share.sendFileFromBuffer(payload.name, payload.mimeType || 'application/octet-stream', buf)
  })
  ipcMain.handle('dialog:pickDownloadFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const folder = result.filePaths[0]
    settings.set({ downloadFolder: folder })
    return folder
  })
  ipcMain.handle('shell:openDownloadFolder', async () => {
    const folder = settings.get().downloadFolder
    ensureDir(folder)
    await shell.openPath(folder)
  })
  ipcMain.handle('history:list', () => {
    const folder = settings.get().downloadFolder
    ensureDir(folder)
    try {
      const entries = fs.readdirSync(folder, { withFileTypes: true })
      return entries
        .filter((e) => e.isFile())
        .map((e) => {
          const full = path.join(folder, e.name)
          const stat = fs.statSync(full)
          return {
            name: e.name,
            path: full,
            size: stat.size,
            modifiedAt: stat.mtimeMs,
          }
        })
        .sort((a, b) => b.modifiedAt - a.modifiedAt)
    } catch {
      return []
    }
  })
  ipcMain.handle('history:open', async (_e, filePath: string) => {
    const folder = settings.get().downloadFolder
    if (!isInsideDownloadFolder(filePath, folder)) {
      return { ok: false, error: 'File is outside the OnCloudShare folder' }
    }
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: 'File not found' }
    }
    const err = await shell.openPath(filePath)
    return err ? { ok: false, error: err } : { ok: true }
  })
  ipcMain.handle('history:reveal', async (_e, filePath: string) => {
    const folder = settings.get().downloadFolder
    if (!isInsideDownloadFolder(filePath, folder) || !fs.existsSync(filePath)) {
      return { ok: false, error: 'File not found' }
    }
    shell.showItemInFolder(filePath)
    return { ok: true }
  })
  ipcMain.handle('history:delete', async (_e, filePath: string) => {
    const folder = settings.get().downloadFolder
    if (!isInsideDownloadFolder(filePath, folder)) {
      return { ok: false, error: 'File is outside the OnCloudShare folder' }
    }
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: 'File not found' }
    }
    try {
      fs.unlinkSync(filePath)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Delete failed' }
    }
  })
  ipcMain.handle('net:localIps', () => getLocalIps())
  ipcMain.handle('app:dismissFirstRun', () => {
    settings.set({ firstRunDone: true })
  })
}

app.whenReady().then(async () => {
  const s = settings.get()
  ensureDir(s.downloadFolder)
  applyStartOnBoot(s.startOnBoot)

  share = new ShareServer({
    onStatus: (status: ServerStatus) => {
      send('status', status)
      refreshTray()
    },
    onItems: (items: RoomItem[]) => send('items', items),
    onPeers: (peers: Peer[]) => send('peers', peers),
    onProgress: (p: FileProgress) => send('progress', p),
    onNotification: (title, body) => notify(title, body),
    getDisplayName: () => settings.get().displayName,
    getDownloadFolder: () => settings.get().downloadFolder,
    getPreferredPort: () => settings.get().preferredPort || 47891,
    getMaxFileBytes: () => {
      const mb = settings.get().maxFileSizeMb || 2048
      return Math.max(1, mb) * 1024 * 1024
    },
  })

  tunnel.setUnexpectedExitHandler(() => {
    share.setTunnelState(
      'expired',
      null,
      'Remote link ended (free tunnels expire when the helper stops). Regenerate a new link.',
    )
    notify('Remote link expired', 'Generate a new link to keep sharing remotely')
    refreshTray()
  })

  await share.start()
  registerIpc()
  createWindow()
  createTray()

  globalShortcut.register('CommandOrControl+Shift+V', () => {
    void sendClipboard()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})

app.on('before-quit', async () => {
  quitting = true
  globalShortcut.unregisterAll()
  await tunnel.stop()
  await share?.stop()
})

app.on('window-all-closed', () => {
  // Keep tray alive on Windows/Linux
  if (process.platform === 'darwin') {
    app.quit()
  }
})
