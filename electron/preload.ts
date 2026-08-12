import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  ServerStatus,
  RoomItem,
  Peer,
  FileProgress,
  DiscoveredRoom,
  JoinResult,
  HistoryFile,
  TunnelDetectResult,
} from './shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void) {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('oncloud', {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (partial: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:save', partial),
  getStatus: (): Promise<ServerStatus> => ipcRenderer.invoke('status:get'),
  createRoom: (name: string, pin?: string): Promise<JoinResult> =>
    ipcRenderer.invoke('room:create', name, pin),
  joinRoom: (opts: {
    code?: string
    host?: string
    port?: number
    pin?: string
    tunnelUrl?: string
  }): Promise<JoinResult> => ipcRenderer.invoke('room:join', opts),
  leaveRoom: (): Promise<void> => ipcRenderer.invoke('room:leave'),
  sendText: (text: string): Promise<void> => ipcRenderer.invoke('room:sendText', text),
  sendClipboard: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('room:sendClipboard'),
  listNearby: (): Promise<DiscoveredRoom[]> => ipcRenderer.invoke('discovery:list'),
  startTunnel: (): Promise<{ ok: boolean; url?: string; error?: string }> =>
    ipcRenderer.invoke('tunnel:start'),
  regenerateTunnel: (): Promise<{ ok: boolean; url?: string; error?: string }> =>
    ipcRenderer.invoke('tunnel:regenerate'),
  stopTunnel: (): Promise<void> => ipcRenderer.invoke('tunnel:stop'),
  detectTunnel: (): Promise<TunnelDetectResult> => ipcRenderer.invoke('tunnel:detect'),
  ensureTunnel: (): Promise<TunnelDetectResult> => ipcRenderer.invoke('tunnel:ensure'),
  setManualTunnel: (url: string): Promise<void> => ipcRenderer.invoke('tunnel:manual', url),
  pickDownloadFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:pickDownloadFolder'),
  openDownloadFolder: (): Promise<void> => ipcRenderer.invoke('shell:openDownloadFolder'),
  listHistory: (): Promise<HistoryFile[]> => ipcRenderer.invoke('history:list'),
  openHistoryFile: (filePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('history:open', filePath),
  revealHistoryFile: (filePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('history:reveal', filePath),
  deleteHistoryFile: (filePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('history:delete', filePath),
  getItems: (): Promise<RoomItem[]> => ipcRenderer.invoke('room:items'),
  downloadFile: (fileId: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('files:download', fileId),
  pauseTransfer: (fileId: string): Promise<boolean> => ipcRenderer.invoke('transfer:pause', fileId),
  resumeTransfer: (fileId: string): Promise<boolean> => ipcRenderer.invoke('transfer:resume', fileId),
  cancelTransfer: (fileId: string): Promise<boolean> => ipcRenderer.invoke('transfer:cancel', fileId),
  listTransfers: (): Promise<FileProgress[]> => ipcRenderer.invoke('transfer:list'),
  sendFileBuffer: (payload: {
    name: string
    mimeType: string
    data: ArrayBuffer
  }): Promise<void> => ipcRenderer.invoke('files:sendBuffer', payload),
  getLocalIpHint: (): Promise<string[]> => ipcRenderer.invoke('net:localIps'),
  dismissFirstRun: (): Promise<void> => ipcRenderer.invoke('app:dismissFirstRun'),
  onStatus: (cb: (status: ServerStatus) => void) => subscribe('status', cb),
  onItems: (cb: (items: RoomItem[]) => void) => subscribe('items', cb),
  onPeers: (cb: (peers: Peer[]) => void) => subscribe('peers', cb),
  onProgress: (cb: (p: FileProgress) => void) => subscribe('progress', cb),
  onNotification: (cb: (payload: { title: string; body: string }) => void) =>
    subscribe('notification', cb),
  onNavigate: (cb: (page: string) => void) => subscribe('navigate', cb),
})
