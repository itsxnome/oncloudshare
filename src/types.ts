export type Peer = {
  id: string
  name: string
  joinedAt: number
}

export type TextItem = {
  id: string
  type: 'text'
  text: string
  from: string
  fromName: string
  createdAt: number
}

export type FileItem = {
  id: string
  type: 'file'
  name: string
  size: number
  mimeType: string
  from: string
  fromName: string
  createdAt: number
  path?: string
}

export type RoomItem = TextItem | FileItem

export type RoomInfo = {
  code: string
  name: string
  pin?: string
  hostName: string
  createdAt: number
  port: number
  localIps: string[]
  tunnelUrl?: string
}

export type DiscoveredRoom = {
  name: string
  code: string
  host: string
  port: number
  hostName: string
}

export type AppSettings = {
  displayName: string
  downloadFolder: string
  preferredPort: number
  pin: string
  startOnBoot: boolean
  tunnelMode: 'none' | 'cloudflare' | 'manual'
  manualTunnelUrl: string
  cloudflaredPath: string
  firstRunDone: boolean
  autoRemoteOnCreate: boolean
  maxFileSizeMb: number
  e2eEncryption: boolean
  dismissedUpdateVersion?: string
}

export type UpdateInfo = {
  updateAvailable: boolean
  currentVersion: string
  latestVersion: string | null
  releaseUrl: string
  releaseName?: string
  error?: string
}

export type FileProgress = {
  fileId: string
  name: string
  received: number
  total: number
  status: 'uploading' | 'downloading' | 'paused' | 'done' | 'error' | 'cancelled'
  error?: string
  direction?: 'upload' | 'download'
  canPause?: boolean
}

export type ServerStatus = {
  running: boolean
  port: number
  localIps: string[]
  room: RoomInfo | null
  peers: Peer[]
  tunnelUrl: string | null
  tunnelStatus: 'idle' | 'starting' | 'active' | 'error' | 'expired'
  tunnelError?: string
  role: 'idle' | 'host' | 'guest'
  connected: boolean
  reconnecting: boolean
  reconnectAttempt: number
}

export type JoinResult = {
  ok: boolean
  error?: string
  room?: RoomInfo
  hostUrl?: string
  isHost?: boolean
}

export type HistoryFile = {
  name: string
  path: string
  size: number
  modifiedAt: number
}

export type TunnelDetectResult = {
  ready: boolean
  path: string | null
  source: 'custom' | 'bundled' | 'userdata' | 'path' | 'common' | null
  installing?: boolean
  error?: string
}

declare global {
  interface Window {
    oncloud: {
      getSettings: () => Promise<AppSettings>
      saveSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
      getStatus: () => Promise<ServerStatus>
      createRoom: (name: string, pin?: string) => Promise<JoinResult>
      joinRoom: (opts: {
        code?: string
        host?: string
        port?: number
        pin?: string
        tunnelUrl?: string
      }) => Promise<JoinResult>
      leaveRoom: () => Promise<void>
      sendText: (text: string) => Promise<void>
      sendClipboard: () => Promise<{ ok: boolean; error?: string }>
      listNearby: () => Promise<DiscoveredRoom[]>
      startTunnel: () => Promise<{ ok: boolean; url?: string; error?: string }>
      regenerateTunnel: () => Promise<{ ok: boolean; url?: string; error?: string }>
      stopTunnel: () => Promise<void>
      detectTunnel: () => Promise<TunnelDetectResult>
      ensureTunnel: () => Promise<TunnelDetectResult>
      setManualTunnel: (url: string) => Promise<void>
      pickDownloadFolder: () => Promise<string | null>
      openDownloadFolder: () => Promise<void>
      listHistory: () => Promise<HistoryFile[]>
      openHistoryFile: (filePath: string) => Promise<{ ok: boolean; error?: string }>
      revealHistoryFile: (filePath: string) => Promise<{ ok: boolean; error?: string }>
      deleteHistoryFile: (filePath: string) => Promise<{ ok: boolean; error?: string }>
      getItems: () => Promise<RoomItem[]>
      downloadFile: (fileId: string) => Promise<{ ok: boolean; path?: string; error?: string }>
      pauseTransfer: (fileId: string) => Promise<boolean>
      resumeTransfer: (fileId: string) => Promise<boolean>
      cancelTransfer: (fileId: string) => Promise<boolean>
      listTransfers: () => Promise<FileProgress[]>
      sendFileBuffer: (payload: {
        name: string
        mimeType: string
        data: ArrayBuffer
      }) => Promise<void>
      getPathForFile: (file: File) => string | null
      sendFilePath: (filePath: string, name?: string, mimeType?: string) => Promise<void>
      getLocalIpHint: () => Promise<string[]>
      dismissFirstRun: () => Promise<void>
      getInstallInfo: () => Promise<{
        portable: boolean
        startOnBoot: boolean
        openAtLogin: boolean
      }>
      checkForUpdates: () => Promise<UpdateInfo>
      openUpdatePage: (url?: string) => Promise<void>
      dismissUpdate: (version: string) => Promise<AppSettings>
      getCachedUpdate: () => Promise<UpdateInfo | null>
      downloadAndInstallUpdate: () => Promise<{ ok: boolean; error?: string }>
      onStatus: (cb: (status: ServerStatus) => void) => () => void
      onItems: (cb: (items: RoomItem[]) => void) => () => void
      onPeers: (cb: (peers: Peer[]) => void) => () => void
      onProgress: (cb: (p: FileProgress) => void) => () => void
      onNotification: (cb: (payload: { title: string; body: string }) => void) => () => void
      onNavigate: (cb: (page: string) => void) => () => void
      onUpdateAvailable: (cb: (info: UpdateInfo) => void) => () => void
    }
  }
}

export {}
