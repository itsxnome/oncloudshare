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
  /** Last update tag the user dismissed ("Later") */
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
