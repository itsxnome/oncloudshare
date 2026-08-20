import os from 'os'
import net from 'net'
import http from 'http'
import fs from 'fs'
import path from 'path'
import express from 'express'
import multer from 'multer'
import { WebSocketServer, WebSocket } from 'ws'
import { randomBytes } from 'crypto'
import { RoomManager } from './room-manager'
import { parseClientMessage, type ServerMessage } from './ws-handler'
import {
  DiskFileAssembler,
  FileTransferAssembler,
  decodeChunkFrame,
  encodeChunkFrame,
  ensureDir,
  streamFileToCallback,
  uniquePath,
  CHUNK_SIZE,
} from './file-transfer'
import { DiscoveryService } from './discovery'
import { TransferController } from './transfer-controller'
import { resolveMobileIndex, resolveMobileFile } from './mobile-path'
import { decryptChunk, deriveKey, encryptChunk } from './crypto-box'
import type {
  Peer,
  RoomInfo,
  RoomItem,
  FileItem,
  FileProgress,
  ServerStatus,
  JoinResult,
} from '../shared/types'

type SocketState = {
  peerId: string
  name: string
  joined: boolean
}

export type ShareServerCallbacks = {
  onStatus: (status: ServerStatus) => void
  onItems: (items: RoomItem[]) => void
  onPeers: (peers: Peer[]) => void
  onProgress: (progress: FileProgress) => void
  onNotification: (title: string, body: string) => void
  getDisplayName: () => string
  getDownloadFolder: () => string
  getPreferredPort: () => number
  getMaxFileBytes: () => number
  getE2EEncryption: () => boolean
}

export function getLocalIps(): string[] {
  const ips: string[] = []
  const ifaces = os.networkInterfaces()
  for (const list of Object.values(ifaces)) {
    if (!list) continue
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address)
      }
    }
  }
  return ips.length ? ips : ['127.0.0.1']
}

function findFreePort(start: number, end: number): Promise<number> {
  const tryPort = (port: number): Promise<number> =>
    new Promise((resolve, reject) => {
      if (port > end) {
        reject(new Error(`No free port in ${start}-${end}`))
        return
      }
      const server = net.createServer()
      server.unref()
      server.on('error', () => {
        tryPort(port + 1).then(resolve, reject)
      })
      server.listen(port, '0.0.0.0', () => {
        server.close(() => resolve(port))
      })
    })
  return tryPort(start)
}

export class ShareServer {
  private app = express()
  private httpServer: http.Server | null = null
  private wss: WebSocketServer | null = null
  private rooms = new RoomManager()
  private discovery = new DiscoveryService()
  private assembler = new FileTransferAssembler()
  private stagingDir = path.join(os.tmpdir(), 'oncloudshare-staging')
  private diskAssembler = new DiskFileAssembler(this.stagingDir)
  private transfers: TransferController
  private sockets = new Map<WebSocket, SocketState>()
  private port = 0
  private tunnelUrl: string | null = null
  private tunnelStatus: ServerStatus['tunnelStatus'] = 'idle'
  private tunnelError?: string
  private role: ServerStatus['role'] = 'idle'
  private guestWs: WebSocket | null = null
  private guestPeerId = ''
  private guestHttpBase = ''
  private connected = false
  private hostPeerId = ''
  private activeDownloads = new Map<string, Promise<{ ok: boolean; path?: string; error?: string }>>()
  private fileStatusWaiters = new Map<string, (nextIndex: number) => void>()
  private encryptedFileIds = new Set<string>()
  private lastJoinOpts: {
    code?: string
    host?: string
    port?: number
    pin?: string
    tunnelUrl?: string
  } | null = null
  private intentionalLeave = false
  private reconnecting = false
  private reconnectAttempt = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private maxReconnectAttempts = 8

  constructor(private cb: ShareServerCallbacks) {
    this.transfers = new TransferController((p) => this.cb.onProgress(p))
    this.app.use(express.json({ limit: '2mb' }))
    this.app.get('/health', (_req, res) => {
      res.json({ ok: true, room: this.rooms.room?.code || null })
    })
    this.app.get('/room', (_req, res) => {
      if (!this.rooms.room) {
        res.status(404).json({ error: 'No room' })
        return
      }
      res.json({
        code: this.rooms.room.code,
        name: this.rooms.room.name,
        hostName: this.rooms.room.hostName,
        hasPin: Boolean(this.rooms.room.pin),
        port: this.port,
      })
    })
    this.app.get('/files/:id', (req, res) => {
      if (!this.rooms.room) {
        res.status(404).json({ error: 'No room' })
        return
      }
      const code = String(req.query.code || '')
      if (code.toUpperCase() !== this.rooms.room.code.toUpperCase()) {
        res.status(403).json({ error: 'Invalid room code' })
        return
      }
      if (this.rooms.room.pin) {
        const pin = String(req.query.pin || '')
        if (pin !== this.rooms.room.pin) {
          res.status(403).json({ error: 'Invalid PIN' })
          return
        }
      }
      const entry = this.rooms.getFile(req.params.id)
      if (!entry) {
        res.status(404).json({ error: 'File not found' })
        return
      }
      const diskPath = entry.diskPath
      const buf = entry.buffer
      if (!diskPath && !buf) {
        res.status(404).json({ error: 'File data unavailable' })
        return
      }
      const total = diskPath ? fs.statSync(diskPath).size : entry.item.size
      const mime = entry.item.mimeType || 'application/octet-stream'
      res.setHeader('Accept-Ranges', 'bytes')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(entry.item.name)}`,
      )

      const range = req.headers.range
      if (range) {
        const match = /^bytes=(\d+)-(\d+)?$/.exec(range)
        if (!match) {
          res.status(416).end()
          return
        }
        const start = Number(match[1])
        const end = match[2] ? Number(match[2]) : total - 1
        if (start >= total || end >= total || start > end) {
          res.status(416).setHeader('Content-Range', `bytes */${total}`).end()
          return
        }
        res.status(206)
        res.setHeader('Content-Type', mime)
        res.setHeader('Content-Length', end - start + 1)
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`)
        if (diskPath) {
          fs.createReadStream(diskPath, { start, end }).pipe(res)
        } else {
          res.send(buf!.subarray(start, end + 1))
        }
        return
      }

      res.setHeader('Content-Type', mime)
      res.setHeader('Content-Length', total)
      if (diskPath) {
        fs.createReadStream(diskPath).pipe(res)
      } else {
        res.send(buf)
      }
    })

    ensureDir(this.stagingDir)
    const upload = multer({
      storage: multer.diskStorage({
        destination: (_req, _file, done) => {
          ensureDir(this.stagingDir)
          done(null, this.stagingDir)
        },
        filename: (_req, file, done) =>
          done(null, `upload-${Date.now()}-${randomBytes(5).toString('hex')}-${path.basename(file.originalname)}`),
      }),
      limits: this.cb.getMaxFileBytes() > 0 ? { fileSize: this.cb.getMaxFileBytes() } : undefined,
    })

    const safeUploadName = (raw: string | undefined, mime: string) => {
      let name = String(raw || '')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .replace(/^\.+/, '')
        .trim()
      if (!name || name === '.' || name === '..') {
        const lower = (mime || '').toLowerCase()
        const ext = lower.includes('png')
          ? 'png'
          : lower.includes('jpeg') || lower.includes('jpg')
            ? 'jpg'
            : lower.includes('heic') || lower.includes('heif')
              ? 'heic'
              : lower.includes('webp')
                ? 'webp'
                : lower.includes('gif')
                  ? 'gif'
                  : lower.includes('pdf')
                    ? 'pdf'
                    : lower.includes('mp4')
                      ? 'mp4'
                      : 'bin'
        name = `upload-${Date.now()}.${ext}`
      }
      return name.slice(0, 180)
    }

    const sendMobilePage = (_req: express.Request, res: express.Response) => {
      const file = resolveMobileIndex()
      if (!file) {
        res
          .status(500)
          .type('text')
          .send('Mobile page missing. Reinstall OnCloudShare.')
        return
      }
      res.sendFile(file)
    }
    this.app.get('/', sendMobilePage)
    this.app.get('/m', sendMobilePage)
    this.app.get('/mobile', sendMobilePage)
    this.app.get('/sw.js', (_req, res) => {
      const file = resolveMobileFile('sw.js')
      if (!file) {
        res.status(404).type('text').send('Service worker missing')
        return
      }
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
      res.setHeader('Service-Worker-Allowed', '/')
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(file)
    })

    this.app.post('/upload', (req, res) => {
      upload.single('file')(req, res, (err: unknown) => {
        if (err) {
          const multerErr = err as { code?: string; message?: string }
          if (multerErr.code === 'LIMIT_FILE_SIZE') {
            res.status(413).json({ error: 'File is too large for upload' })
            return
          }
          res.status(400).json({
            error: multerErr.message || 'Could not parse upload from phone',
          })
          return
        }

        try {
          if (this.role !== 'host' || !this.rooms.room) {
            res.status(404).json({ error: 'No active room on this host' })
            return
          }
          const code = String(req.body?.code || '')
          if (code.toUpperCase() !== this.rooms.room.code.toUpperCase()) {
            res.status(403).json({ error: 'Invalid room code' })
            return
          }
          if (!this.rooms.validatePin(String(req.body?.pin || ''))) {
            res.status(403).json({ error: 'Invalid PIN' })
            return
          }
          const file = req.file
          if (!file || !file.path) {
            res.status(400).json({
              error:
                'No file data received. On iPhone, use Attach if drag & drop fails.',
            })
            return
          }
          if (!file.size) {
            res.status(400).json({
              error:
                'Dropped file was empty. Try Attach, or share a smaller/exported photo.',
            })
            return
          }
          const max = this.cb.getMaxFileBytes()
          if (max > 0 && Number.isFinite(max) && file.size > max) {
            res.status(413).json({
              error: `File exceeds the ${Math.round(max / (1024 * 1024))} MB limit`,
            })
            return
          }
          const fromName = String(req.body?.fromName || 'Phone').slice(0, 64)
          const from = String(req.body?.peerId || randomBytes(4).toString('hex'))
          const mime = file.mimetype || 'application/octet-stream'
          const name = safeUploadName(file.originalname, mime)
          const fileMeta = {
            name,
            size: file.size,
            mimeType: mime,
            from,
            fromName,
          }
          let item: FileItem
          if (file.size > 8 * 1024 * 1024) {
            item = this.rooms.addFileFromDisk(fileMeta, file.path)
          } else {
            const buffer = fs.readFileSync(file.path)
            fs.unlinkSync(file.path)
            item = this.rooms.addFileMeta(fileMeta, buffer)
          }
          this.broadcast({ type: 'item', item })
          this.cb.onItems(this.rooms.items)
          try {
            this.cb.onNotification('File from phone', `${item.name} · ${fromName}`)
          } catch {
            /* ignore notification failures */
          }
          res.json({ ok: true, id: item.id })
        } catch (e) {
          console.error('[upload]', e)
          res.status(500).json({
            error: e instanceof Error ? e.message : 'Upload failed',
          })
        }
      })
    })
  }

  async start(): Promise<void> {
    if (this.httpServer) return
    const preferred = this.cb.getPreferredPort() || 47891
    this.port = await findFreePort(preferred, preferred + 8)
    this.httpServer = http.createServer(this.app)
    this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' })
    this.wss.on('connection', (ws) => this.handleConnection(ws))
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(this.port, '0.0.0.0', () => resolve())
      this.httpServer!.on('error', reject)
    })
    this.discovery.start()
    this.discovery.onRoomsChanged(() => this.emitStatus())
    this.emitStatus()
  }

  async stop(): Promise<void> {
    await this.leaveRoom()
    this.discovery.stop()
    for (const ws of this.sockets.keys()) {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
    this.sockets.clear()
    await new Promise<void>((resolve) => {
      if (!this.httpServer) {
        resolve()
        return
      }
      this.httpServer.close(() => resolve())
    })
    this.httpServer = null
    this.wss = null
    this.port = 0
    this.emitStatus()
  }

  getStatus(): ServerStatus {
    return {
      running: Boolean(this.httpServer),
      port: this.port,
      localIps: getLocalIps(),
      room: this.rooms.room,
      peers: this.rooms.listPeers(),
      tunnelUrl: this.tunnelUrl || this.rooms.room?.tunnelUrl || null,
      tunnelStatus: this.tunnelStatus,
      tunnelError: this.tunnelError,
      role: this.role,
      connected: this.connected,
      reconnecting: this.reconnecting,
      reconnectAttempt: this.reconnectAttempt,
    }
  }

  listNearby() {
    return this.discovery.list()
  }

  getItems() {
    return this.rooms.items
  }

  setTunnelState(
    status: ServerStatus['tunnelStatus'],
    url: string | null,
    error?: string,
  ) {
    this.tunnelStatus = status
    this.tunnelUrl = url
    this.tunnelError = error
    this.rooms.setTunnelUrl(url || undefined)
    this.emitStatus()
  }

  async createRoom(name: string, pin?: string): Promise<JoinResult> {
    await this.start()
    await this.leaveRoomInternal(false)
    const displayName = this.cb.getDisplayName()
    const room = this.rooms.create({
      name,
      hostName: displayName,
      port: this.port,
      localIps: getLocalIps(),
      pin,
    })
    this.role = 'host'
    this.connected = true
    this.hostPeerId = randomBytes(8).toString('hex')
    this.rooms.addPeer({
      id: this.hostPeerId,
      name: displayName,
      joinedAt: Date.now(),
    })
    this.discovery.publish({
      name: `OnCloudShare-${room.code}`,
      port: this.port,
      code: room.code,
      roomName: room.name,
      hostName: displayName,
    })
    this.emitAll()
    return { ok: true, room, isHost: true, hostUrl: `ws://127.0.0.1:${this.port}/ws` }
  }

  async joinRoom(opts: {
    code?: string
    host?: string
    port?: number
    pin?: string
    tunnelUrl?: string
  }): Promise<JoinResult> {
    await this.start()
    this.clearReconnectTimer()
    this.intentionalLeave = false
    await this.leaveRoomInternal(false)
    this.lastJoinOpts = { ...opts }
    return this.connectAsGuest(opts, false)
  }

  private resolveGuestWsUrl(opts: {
    code?: string
    host?: string
    port?: number
    tunnelUrl?: string
  }): { ok: true; wsUrl: string; opts: typeof opts } | { ok: false; error: string } {
    let wsUrl = ''
    const next = { ...opts }
    if (opts.tunnelUrl) {
      const base = opts.tunnelUrl.replace(/\/$/, '')
      if (base.startsWith('https://')) {
        wsUrl = base.replace(/^https/, 'wss') + '/ws'
      } else if (base.startsWith('http://')) {
        wsUrl = base.replace(/^http/, 'ws') + '/ws'
      } else if (base.startsWith('wss://') || base.startsWith('ws://')) {
        wsUrl = base.endsWith('/ws') ? base : base + '/ws'
      } else {
        wsUrl = `wss://${base}/ws`
      }
    } else if (opts.host && opts.port) {
      wsUrl = `ws://${opts.host}:${opts.port}/ws`
    } else if (opts.code) {
      const nearby = this.discovery
        .list()
        .find((r) => r.code.toUpperCase() === opts.code!.toUpperCase())
      if (!nearby) {
        return { ok: false, error: 'Room not found on LAN. Try IP:port or a tunnel URL.' }
      }
      wsUrl = `ws://${nearby.host}:${nearby.port}/ws`
      next.host = nearby.host
      next.port = nearby.port
    } else {
      return { ok: false, error: 'Provide a room code, host, or tunnel URL.' }
    }
    return { ok: true, wsUrl, opts: next }
  }

  private connectAsGuest(
    opts: {
      code?: string
      host?: string
      port?: number
      pin?: string
      tunnelUrl?: string
    },
    isReconnect: boolean,
  ): Promise<JoinResult> {
    const resolved = this.resolveGuestWsUrl(opts)
    if (!resolved.ok) return Promise.resolve(resolved)
    const { wsUrl } = resolved
    opts = { ...opts, ...resolved.opts }

    return new Promise<JoinResult>((resolve) => {
      const peerId = isReconnect && this.guestPeerId ? this.guestPeerId : randomBytes(8).toString('hex')
      this.guestPeerId = peerId
      let settled = false
      const ws = new WebSocket(wsUrl, {
        headers: {
          'User-Agent': 'OnCloudShare',
          'Bypass-Tunnel-Reminder': 'true',
        },
      })
      this.guestWs = ws

      const fail = (error: string) => {
        if (settled) return
        settled = true
        try {
          ws.close()
        } catch {
          /* ignore */
        }
        this.guestWs = null
        if (!isReconnect) {
          this.guestHttpBase = ''
          this.role = 'idle'
          this.connected = false
          this.reconnecting = false
        }
        resolve({ ok: false, error })
      }

      const timer = setTimeout(
        () => fail(isReconnect ? 'Reconnect timed out' : 'Connection timed out'),
        isReconnect ? 8000 : 12000,
      )

      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'join',
            peerId,
            name: this.cb.getDisplayName(),
            code: opts.code || '',
            pin: opts.pin,
          }),
        )
      })

      ws.on('message', (data) => {
        let msg: ServerMessage
        try {
          msg = JSON.parse(data.toString())
        } catch {
          return
        }
        if (msg.type === 'error') {
          clearTimeout(timer)
          fail(msg.message)
          return
        }
        if (msg.type === 'welcome') {
          clearTimeout(timer)
          if (settled) return
          settled = true
          this.role = 'guest'
          this.connected = true
          this.reconnecting = false
          this.reconnectAttempt = 0
          this.guestHttpBase = wsUrl
            .replace(/^wss:/, 'https:')
            .replace(/^ws:/, 'http:')
            .replace(/\/ws$/, '')
          const room = msg.room as RoomInfo
          this.rooms.attachExisting({
            ...room,
            pin: opts.pin || room.pin,
          })
          if (opts.pin) this.rooms.room!.pin = opts.pin
          this.rooms.items = msg.items || []
          this.rooms.peers.clear()
          for (const p of msg.peers || []) this.rooms.addPeer(p)
          this.emitAll()
          if (isReconnect) {
            this.cb.onNotification('Reconnected', 'Back in the share room')
          }
          resolve({ ok: true, room, isHost: false, hostUrl: wsUrl })
          return
        }
        this.handleGuestMessage(msg)
      })

      ws.on('error', () => {
        if (!settled) fail(isReconnect ? 'Reconnect failed' : 'Could not connect to room host.')
      })
      ws.on('close', () => {
        if (!settled) {
          clearTimeout(timer)
          fail(isReconnect ? 'Reconnect closed' : 'Connection closed.')
          return
        }
        this.connected = false
        this.guestWs = null
        if (this.intentionalLeave) {
          this.role = 'idle'
          this.rooms.clear()
          this.reconnecting = false
          this.emitAll()
          return
        }
        this.scheduleReconnect()
      })
    })
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private scheduleReconnect() {
    if (!this.lastJoinOpts || this.intentionalLeave) {
      this.role = 'idle'
      this.rooms.clear()
      this.reconnecting = false
      this.emitAll()
      this.cb.onNotification('Disconnected', 'Left the share room')
      return
    }
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.role = 'idle'
      this.rooms.clear()
      this.reconnecting = false
      this.reconnectAttempt = 0
      this.emitAll()
      this.cb.onNotification('Disconnected', 'Could not reconnect. Join the room again.')
      return
    }
    this.reconnecting = true
    this.reconnectAttempt += 1
    const delay = Math.min(10000, 1000 * this.reconnectAttempt)
    this.emitStatus()
    this.cb.onNotification(
      'Connection lost',
      `Reconnecting (${this.reconnectAttempt}/${this.maxReconnectAttempts})…`,
    )
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      void this.connectAsGuest(this.lastJoinOpts!, true).then((result) => {
        if (!result.ok) this.scheduleReconnect()
      })
    }, delay)
  }

  async leaveRoom() {
    this.intentionalLeave = true
    this.clearReconnectTimer()
    this.lastJoinOpts = null
    this.reconnecting = false
    this.reconnectAttempt = 0
    await this.leaveRoomInternal(true)
  }

  private async leaveRoomInternal(emit: boolean) {
    this.clearReconnectTimer()
    if (this.role === 'host') {
      this.broadcast({ type: 'room-closed' })
      this.discovery.unpublish()
    }
    if (this.guestWs) {
      try {
        this.guestWs.send(JSON.stringify({ type: 'leave' }))
        this.guestWs.close()
      } catch {
        /* ignore */
      }
      this.guestWs = null
    }
    this.guestHttpBase = ''
    for (const [ws, state] of this.sockets) {
      if (state.joined) {
        try {
          ws.close()
        } catch {
          /* ignore */
        }
      }
    }
    this.rooms.clear()
    this.assembler = new FileTransferAssembler()
    this.diskAssembler.clear()
    fs.rmSync(this.stagingDir, { recursive: true, force: true })
    ensureDir(this.stagingDir)
    this.diskAssembler = new DiskFileAssembler(this.stagingDir)
    this.encryptedFileIds.clear()
    this.role = 'idle'
    this.connected = false
    this.hostPeerId = ''
    this.guestPeerId = ''
    this.reconnecting = false
    if (emit) this.emitAll()
  }

  private assertFileSize(size: number, name: string) {
    const max = this.cb.getMaxFileBytes()
    if (max > 0 && Number.isFinite(max) && size > max) {
      const maxMb = Math.round(max / (1024 * 1024))
      const sizeMb = (size / (1024 * 1024)).toFixed(1)
      throw new Error(
        `"${name}" is ${sizeMb} MB and exceeds the ${maxMb} MB limit. Raise it in Settings or split the file.`,
      )
    }
  }

  private friendlyIoError(e: unknown, fallback: string) {
    const err = e as NodeJS.ErrnoException
    if (err?.code === 'ENOSPC') return 'Disk is full. Free some space and try again.'
    if (err?.code === 'EACCES' || err?.code === 'EPERM') {
      return 'Permission denied saving the file. Choose another download folder in Settings.'
    }
    if (err?.code === 'ENOTFOUND' || err?.code === 'ECONNREFUSED') {
      return 'Network error reaching the host. Check Wi‑Fi or the remote link.'
    }
    return e instanceof Error ? e.message : fallback
  }

  async sendText(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    if (this.role === 'host') {
      const item = this.rooms.addText({
        text: trimmed,
        from: this.hostPeerId,
        fromName: this.cb.getDisplayName(),
      })
      this.broadcast({ type: 'item', item })
      this.cb.onItems(this.rooms.items)
    } else if (this.guestWs && this.guestWs.readyState === WebSocket.OPEN) {
      this.guestWs.send(JSON.stringify({ type: 'text', text: trimmed }))
    }
  }

  async sendFileFromPath(
    filePath: string,
    name = path.basename(filePath),
    mimeType = 'application/octet-stream',
  ): Promise<void> {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) throw new Error('Selected path is not a file')
    this.assertFileSize(stat.size, name)
    const fileId = randomBytes(8).toString('hex')
    const totalChunks = Math.ceil(stat.size / CHUNK_SIZE) || 1
    this.transfers.start({ fileId, name, total: stat.size, direction: 'upload' })

    if (this.role === 'host') {
      await streamFileToCallback(
        filePath,
        CHUNK_SIZE,
        async (index, data) => {
          const ok = await this.transfers.waitIfPaused(fileId)
          if (!ok || this.transfers.isCancelled(fileId)) throw new Error('cancelled')
          this.transfers.setReceived(fileId, Math.min(stat.size, index * CHUNK_SIZE + data.length))
        },
        () => this.transfers.isCancelled(fileId),
      )
      const item = this.rooms.addFileFromDisk(
        {
          id: fileId,
          name,
          size: stat.size,
          mimeType,
          from: this.hostPeerId,
          fromName: this.cb.getDisplayName(),
        },
        filePath,
      )
      this.transfers.complete(fileId, stat.size)
      this.broadcast({ type: 'item', item })
      this.cb.onItems(this.rooms.items)
      this.cb.onNotification('File shared', `${name} is in the room`)
      return
    }

    const ws = this.guestWs
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('Not connected to a room')
    const nextIndexPromise = new Promise<number>((resolve) => {
      const timer = setTimeout(() => {
        this.fileStatusWaiters.delete(fileId)
        resolve(0)
      }, 3000)
      this.fileStatusWaiters.set(fileId, (nextIndex) => {
        clearTimeout(timer)
        resolve(nextIndex)
      })
    })
    ws.send(
      JSON.stringify({
        type: 'file-meta',
        fileId,
        name,
        size: stat.size,
        mimeType,
        totalChunks,
        chunkSize: CHUNK_SIZE,
        binary: true,
        resume: true,
        encrypted: this.cb.getE2EEncryption() && Boolean(this.rooms.room?.pin),
      }),
    )
    const nextIndex = await nextIndexPromise
    await streamFileToCallback(
      filePath,
      CHUNK_SIZE,
      async (index, data) => {
        if (index < nextIndex) return
        const ok = await this.transfers.waitIfPaused(fileId)
        if (!ok || this.transfers.isCancelled(fileId)) throw new Error('cancelled')
        const payload =
          this.cb.getE2EEncryption() && this.rooms.room?.pin
            ? encryptChunk(deriveKey(this.rooms.room.pin), data)
            : data
        await new Promise<void>((resolve, reject) => {
          ws.send(encodeChunkFrame(fileId, index, payload), (error) =>
            error ? reject(error) : resolve(),
          )
        })
        this.transfers.setReceived(fileId, Math.min(stat.size, index * CHUNK_SIZE + data.length))
      },
      () => this.transfers.isCancelled(fileId),
    )
    this.transfers.complete(fileId, stat.size)
  }

  async sendFileFromBuffer(
    name: string,
    mimeType: string,
    buffer: Buffer,
  ): Promise<void> {
    this.assertFileSize(buffer.length, name)
    if (buffer.length > 8 * 1024 * 1024) {
      ensureDir(this.stagingDir)
      const tempPath = uniquePath(this.stagingDir, name)
      fs.writeFileSync(tempPath, buffer)
      await this.sendFileFromPath(tempPath, name, mimeType)
      return
    }
    if (this.role === 'host') {
      const fileId = randomBytes(8).toString('hex')
      this.transfers.start({
        fileId,
        name,
        total: buffer.length,
        direction: 'upload',
      })
      // Chunked local "send" so large files show a loader
      const chunks = Math.ceil(buffer.length / CHUNK_SIZE) || 1
      for (let i = 0; i < chunks; i++) {
        const ok = await this.transfers.waitIfPaused(fileId)
        if (!ok || this.transfers.isCancelled(fileId)) {
          this.transfers.cancel(fileId)
          return
        }
        this.transfers.setReceived(fileId, Math.min(buffer.length, (i + 1) * CHUNK_SIZE))
        if (i % 4 === 0) await new Promise((r) => setImmediate(r))
      }
      if (this.transfers.isCancelled(fileId)) return
      const item = this.rooms.addFileMeta(
        {
          id: fileId,
          name,
          size: buffer.length,
          mimeType,
          from: this.hostPeerId,
          fromName: this.cb.getDisplayName(),
        },
        buffer,
      )
      this.transfers.complete(fileId, buffer.length)
      this.broadcast({ type: 'item', item })
      this.cb.onItems(this.rooms.items)
      this.cb.onNotification('File shared', `${name} is in the room`)
      return
    }

    if (!this.guestWs || this.guestWs.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to a room')
    }

    const fileId = randomBytes(8).toString('hex')
    const chunks = Math.ceil(buffer.length / CHUNK_SIZE) || 1
    this.transfers.start({
      fileId,
      name,
      total: buffer.length,
      direction: 'upload',
    })
    this.guestWs.send(
      JSON.stringify({
        type: 'file-meta',
        fileId,
        name,
        size: buffer.length,
        mimeType,
        totalChunks: chunks,
      }),
    )

    for (let i = 0; i < chunks; i++) {
      const ok = await this.transfers.waitIfPaused(fileId)
      if (!ok || this.transfers.isCancelled(fileId)) {
        try {
          this.guestWs.send(JSON.stringify({ type: 'file-cancel', fileId }))
        } catch {
          /* ignore */
        }
        return
      }
      const start = i * CHUNK_SIZE
      const slice = buffer.subarray(start, start + CHUNK_SIZE)
      this.guestWs.send(
        JSON.stringify({
          type: 'file-chunk',
          fileId,
          index: i,
          data: slice.toString('base64'),
        }),
      )
      this.transfers.setReceived(fileId, Math.min(buffer.length, (i + 1) * CHUNK_SIZE))
    }
    if (!this.transfers.isCancelled(fileId)) {
      this.transfers.complete(fileId, buffer.length)
    }
  }

  async downloadFile(fileId: string): Promise<{ ok: boolean; path?: string; error?: string }> {
    const running = this.activeDownloads.get(fileId)
    if (running) return running

    const job = this.runDownload(fileId).finally(() => {
      this.activeDownloads.delete(fileId)
    })
    this.activeDownloads.set(fileId, job)
    return job
  }

  private async runDownload(
    fileId: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }> {
    const local = this.rooms.getFile(fileId)
    if (local) {
      const total = local.diskPath ? fs.statSync(local.diskPath).size : local.item.size
      this.transfers.start({
        fileId,
        name: local.item.name,
        total,
        direction: 'download',
      })
      try {
        const folder = this.cb.getDownloadFolder()
        const dest = uniquePath(folder, local.item.name)
        this.transfers.setReceived(fileId, 0)
        // Give the UI a moment to paint the progress bar
        await new Promise((r) => setTimeout(r, 80))
        const chunkSize = Math.max(32 * 1024, Math.floor(total / 20) || 32 * 1024)
        const fd = fs.openSync(dest, 'w')
        try {
          if (local.diskPath) {
            let offset = 0
            for await (const raw of fs.createReadStream(local.diskPath, { highWaterMark: CHUNK_SIZE })) {
              const ok = await this.transfers.waitIfPaused(fileId)
              if (!ok || this.transfers.isCancelled(fileId)) {
                return { ok: false, error: 'Download cancelled' }
              }
              const chunk = Buffer.from(raw)
              fs.writeSync(fd, chunk, 0, chunk.length, offset)
              offset += chunk.length
              this.transfers.setReceived(fileId, offset)
            }
          } else if (local.buffer) {
            for (let offset = 0; offset < local.buffer.length; offset += chunkSize) {
              const ok = await this.transfers.waitIfPaused(fileId)
              if (!ok || this.transfers.isCancelled(fileId)) {
                return { ok: false, error: 'Download cancelled' }
              }
              const end = Math.min(local.buffer.length, offset + chunkSize)
              fs.writeSync(fd, local.buffer.subarray(offset, end))
              this.transfers.setReceived(fileId, end)
              await new Promise((r) => setTimeout(r, 16))
            }
          } else {
            throw new Error('File data unavailable')
          }
        } finally {
          try {
            fs.closeSync(fd)
          } catch {
            /* ignore */
          }
        }
        local.item.path = dest
        this.rooms.items = this.rooms.items.map((i) =>
          i.id === fileId && i.type === 'file' ? { ...i, path: dest } : i,
        )
        this.transfers.complete(fileId, total)
        this.cb.onItems(this.rooms.items)
        this.cb.onNotification('Saved', dest)
        return { ok: true, path: dest }
      } catch (e) {
        const msg = this.friendlyIoError(e, 'Save failed')
        this.transfers.fail(fileId, msg)
        return { ok: false, error: msg }
      }
    }

    if (this.role !== 'guest' || !this.guestHttpBase || !this.rooms.room) {
      return { ok: false, error: 'File not available. Keep the host room open and try again.' }
    }

    const item = this.rooms.items.find((i) => i.type === 'file' && i.id === fileId)
    if (!item || item.type !== 'file') {
      return { ok: false, error: 'Unknown file' }
    }

    try {
      this.assertFileSize(item.size, item.name)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'File too large' }
    }

    this.transfers.start({
      fileId,
      name: item.name,
      total: item.size,
      direction: 'download',
    })

    try {
      const params = new URLSearchParams({ code: this.rooms.room.code })
      if (this.rooms.room.pin) params.set('pin', this.rooms.room.pin)
      const url = `${this.guestHttpBase}/files/${fileId}?${params.toString()}`
      const dest = uniquePath(this.cb.getDownloadFolder(), item.name)
      const response = await fetch(url)
      if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`)
      const fd = fs.openSync(dest, 'w')
      let offset = 0
      try {
        const reader = response.body.getReader()
        while (true) {
          const ok = await this.transfers.waitIfPaused(fileId)
          if (!ok || this.transfers.isCancelled(fileId)) {
            await reader.cancel()
            throw new Error('Download cancelled')
          }
          const { done, value } = await reader.read()
          if (done) break
          const chunk = Buffer.from(value)
          fs.writeSync(fd, chunk, 0, chunk.length, offset)
          offset += chunk.length
          this.transfers.setReceived(fileId, offset)
        }
      } finally {
        fs.closeSync(fd)
      }
      this.rooms.storeFilePath(item.id, { ...item, path: dest }, dest)
      this.rooms.items = this.rooms.items.map((i) =>
        i.id === fileId && i.type === 'file' ? { ...i, path: dest } : i,
      )
      this.transfers.complete(fileId, offset)
      this.cb.onItems(this.rooms.items)
      this.cb.onNotification('Saved', dest)
      return { ok: true, path: dest }
    } catch (e) {
      const msg = this.friendlyIoError(e, 'Download failed')
      if (!this.transfers.isCancelled(fileId)) {
        this.transfers.fail(fileId, msg)
      }
      return { ok: false, error: msg }
    }
  }

  pauseTransfer(fileId: string) {
    return this.transfers.pause(fileId)
  }

  resumeTransfer(fileId: string) {
    return this.transfers.resume(fileId)
  }

  cancelTransfer(fileId: string) {
    return this.transfers.cancel(fileId)
  }

  listTransfers() {
    return this.transfers.list()
  }

  private handleConnection(ws: WebSocket) {
    this.sockets.set(ws, { peerId: '', name: '', joined: false })
    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        const state = this.sockets.get(ws)
        if (!state?.joined) return
        const frame = decodeChunkFrame(Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer))
        if (!frame) return
        let payload = frame.data
        if (this.encryptedFileIds.has(frame.fileId)) {
          if (!this.rooms.room?.pin) return
          try {
            payload = decryptChunk(deriveKey(this.rooms.room.pin), payload)
          } catch {
            this.send(ws, { type: 'error', message: 'Could not decrypt chunk. Check the room PIN.' })
            return
          }
        }
        const entry = this.diskAssembler.addChunk(frame.fileId, frame.index, payload)
        if (!entry) return
        this.transfers.setReceived(frame.fileId, entry.received)
        this.completeDiskTransfer(frame.fileId)
        return
      }
      const msg = parseClientMessage(raw.toString())
      if (!msg) return
      this.handleHostClientMessage(ws, msg)
    })
    ws.on('close', () => {
      const state = this.sockets.get(ws)
      this.sockets.delete(ws)
      if (state?.joined) {
        this.rooms.removePeer(state.peerId)
        this.broadcast({ type: 'peers', peers: this.rooms.listPeers() })
        this.cb.onPeers(this.rooms.listPeers())
        this.emitStatus()
      }
    })
  }

  private completeDiskTransfer(fileId: string) {
    if (!this.diskAssembler.isComplete(fileId)) return
    const assembled = this.diskAssembler.finalizeInPlace(fileId)
    if (!assembled) return
    this.encryptedFileIds.delete(fileId)
    const item = this.rooms.addFileFromDisk(
      {
        id: assembled.meta.fileId,
        name: assembled.meta.name,
        size: assembled.meta.size,
        mimeType: assembled.meta.mimeType,
        from: assembled.meta.from,
        fromName: assembled.meta.fromName,
      },
      assembled.path,
    )
    this.transfers.complete(item.id, item.size)
    this.broadcast({ type: 'item', item })
    this.cb.onItems(this.rooms.items)
    this.cb.onNotification('File received', `${item.name} from ${item.fromName}`)
  }

  private handleHostClientMessage(ws: WebSocket, msg: ReturnType<typeof parseClientMessage>) {
    if (!msg) return
    const state = this.sockets.get(ws)
    if (!state) return

    if (msg.type === 'ping') {
      this.send(ws, { type: 'pong' })
      return
    }

    if (msg.type === 'join') {
      if (this.role !== 'host' || !this.rooms.room) {
        this.send(ws, { type: 'error', message: 'No active room on this host.' })
        return
      }
      if (msg.code && msg.code.toUpperCase() !== this.rooms.room.code.toUpperCase()) {
        this.send(ws, { type: 'error', message: 'Invalid room code.' })
        return
      }
      if (!this.rooms.validatePin(msg.pin)) {
        this.send(ws, { type: 'error', message: 'Invalid PIN.' })
        return
      }
      state.peerId = msg.peerId
      state.name = msg.name || 'Guest'
      state.joined = true
      this.rooms.addPeer({
        id: state.peerId,
        name: state.name,
        joinedAt: Date.now(),
      })
      this.send(ws, {
        type: 'welcome',
        peerId: state.peerId,
        room: this.rooms.room,
        peers: this.rooms.listPeers(),
        items: this.rooms.items,
      })
      this.broadcast({ type: 'peers', peers: this.rooms.listPeers() }, ws)
      this.cb.onPeers(this.rooms.listPeers())
      this.emitStatus()
      this.cb.onNotification('Peer joined', `${state.name} joined the room`)
      return
    }

    if (!state.joined) {
      this.send(ws, { type: 'error', message: 'Join the room first.' })
      return
    }

    if (msg.type === 'text') {
      const item = this.rooms.addText({
        text: msg.text,
        from: state.peerId,
        fromName: state.name,
      })
      this.broadcast({ type: 'item', item })
      this.cb.onItems(this.rooms.items)
      this.cb.onNotification('New text', `From ${state.name}`)
      return
    }

    if (msg.type === 'file-meta') {
      try {
        this.assertFileSize(msg.size, msg.name)
      } catch (e) {
        this.send(ws, {
          type: 'error',
          message: e instanceof Error ? e.message : 'File too large',
        })
        return
      }
      const entry = this.diskAssembler.start({
        fileId: msg.fileId,
        name: msg.name,
        size: msg.size,
        mimeType: msg.mimeType,
        totalChunks: msg.totalChunks,
        chunkSize: msg.chunkSize,
        from: state.peerId,
        fromName: state.name,
        resume: msg.resume,
      })
      if (msg.encrypted) this.encryptedFileIds.add(msg.fileId)
      else this.encryptedFileIds.delete(msg.fileId)
      this.transfers.start({
        fileId: msg.fileId,
        name: msg.name,
        total: msg.size,
        direction: 'download',
      })
      this.send(ws, { type: 'file-status', fileId: msg.fileId, nextIndex: entry.nextIndex })
      return
    }

    if (msg.type === 'file-chunk') {
      const entry = this.diskAssembler.addChunkBase64(msg.fileId, msg.index, msg.data)
      if (!entry) return
      this.transfers.setReceived(entry.fileId, entry.received)
      this.completeDiskTransfer(msg.fileId)
      return
    }

    if (msg.type === 'file-cancel') {
      this.assembler.cancel(msg.fileId)
      this.diskAssembler.cancel(msg.fileId)
      this.encryptedFileIds.delete(msg.fileId)
      this.transfers.cancel(msg.fileId)
      return
    }

    if (msg.type === 'leave') {
      ws.close()
    }
  }

  private handleGuestMessage(msg: ServerMessage) {
    if (msg.type === 'file-status') {
      const resolve = this.fileStatusWaiters.get(msg.fileId)
      this.fileStatusWaiters.delete(msg.fileId)
      resolve?.(msg.nextIndex)
      return
    }
    if (msg.type === 'item') {
      if (msg.item.type === 'file') {
        // Guest only gets metadata; download is host-side for v1 relay
        this.rooms.items = [...this.rooms.items.filter((i) => i.id !== msg.item.id), msg.item]
      } else {
        this.rooms.items = [...this.rooms.items.filter((i) => i.id !== msg.item.id), msg.item]
      }
      this.cb.onItems(this.rooms.items)
      if (msg.item.type === 'text') {
        this.cb.onNotification('New text', `From ${msg.item.fromName}`)
      } else {
        this.cb.onNotification('New file', `${msg.item.name} from ${msg.item.fromName}`)
      }
      return
    }
    if (msg.type === 'items') {
      this.rooms.items = msg.items
      this.cb.onItems(this.rooms.items)
      return
    }
    if (msg.type === 'peers') {
      this.rooms.peers.clear()
      for (const p of msg.peers) this.rooms.addPeer(p)
      this.cb.onPeers(this.rooms.listPeers())
      this.emitStatus()
      return
    }
    if (msg.type === 'room-closed') {
      this.intentionalLeave = true
      this.lastJoinOpts = null
      this.cb.onNotification('Room closed', 'The host ended the room')
      void this.leaveRoom()
      return
    }
    if (msg.type === 'file-progress') {
      this.cb.onProgress(msg.progress)
    }
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }

  private broadcast(msg: ServerMessage, except?: WebSocket) {
    for (const [ws, state] of this.sockets) {
      if (except && ws === except) continue
      if (!state.joined) continue
      this.send(ws, msg)
    }
  }

  private emitStatus() {
    this.cb.onStatus(this.getStatus())
  }

  private emitAll() {
    this.emitStatus()
    this.cb.onPeers(this.rooms.listPeers())
    this.cb.onItems(this.rooms.items)
  }
}
