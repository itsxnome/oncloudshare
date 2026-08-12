import { randomBytes } from 'crypto'
import type { Peer, RoomInfo, RoomItem, TextItem, FileItem } from '../shared/types'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateRoomCode(length = 6): string {
  const bytes = randomBytes(length)
  let code = ''
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return code
}

export class RoomManager {
  room: RoomInfo | null = null
  peers = new Map<string, Peer>()
  items: RoomItem[] = []
  files = new Map<string, { item: FileItem; buffer: Buffer }>()
  private maxItems = 200

  create(opts: {
    name: string
    hostName: string
    port: number
    localIps: string[]
    pin?: string
  }): RoomInfo {
    this.clear()
    this.room = {
      code: generateRoomCode(),
      name: opts.name.trim() || 'Share Room',
      pin: opts.pin?.trim() || undefined,
      hostName: opts.hostName,
      createdAt: Date.now(),
      port: opts.port,
      localIps: opts.localIps,
    }
    return this.room
  }

  attachExisting(room: RoomInfo) {
    this.room = room
  }

  setTunnelUrl(url?: string) {
    if (this.room) {
      this.room.tunnelUrl = url
    }
  }

  clear() {
    this.room = null
    this.peers.clear()
    this.items = []
    this.files.clear()
  }

  addPeer(peer: Peer) {
    this.peers.set(peer.id, peer)
  }

  removePeer(id: string) {
    this.peers.delete(id)
  }

  listPeers(): Peer[] {
    return Array.from(this.peers.values()).sort((a, b) => a.joinedAt - b.joinedAt)
  }

  validatePin(pin?: string): boolean {
    if (!this.room?.pin) return true
    return (pin || '') === this.room.pin
  }

  addText(item: Omit<TextItem, 'id' | 'type' | 'createdAt'> & { id?: string }): TextItem {
    const textItem: TextItem = {
      id: item.id || randomBytes(8).toString('hex'),
      type: 'text',
      text: item.text,
      from: item.from,
      fromName: item.fromName,
      createdAt: Date.now(),
    }
    this.pushItem(textItem)
    return textItem
  }

  addFileMeta(
    item: Omit<FileItem, 'id' | 'type' | 'createdAt'> & { id?: string },
    buffer: Buffer,
  ): FileItem {
    const fileItem: FileItem = {
      id: item.id || randomBytes(8).toString('hex'),
      type: 'file',
      name: item.name,
      size: item.size,
      mimeType: item.mimeType || 'application/octet-stream',
      from: item.from,
      fromName: item.fromName,
      createdAt: Date.now(),
    }
    this.files.set(fileItem.id, { item: fileItem, buffer })
    this.pushItem(fileItem)
    return fileItem
  }

  storeFileBuffer(fileId: string, item: FileItem, buffer: Buffer) {
    this.files.set(fileId, { item: { ...item, path: item.path }, buffer })
  }

  getFile(id: string) {
    return this.files.get(id)
  }

  private pushItem(item: RoomItem) {
    this.items.push(item)
    if (this.items.length > this.maxItems) {
      const removed = this.items.shift()
      if (removed?.type === 'file') {
        this.files.delete(removed.id)
      }
    }
  }
}
