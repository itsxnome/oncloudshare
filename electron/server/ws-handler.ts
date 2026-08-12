import type { Peer, RoomItem, FileProgress } from '../shared/types'

export type ClientMessage =
  | { type: 'join'; peerId: string; name: string; code: string; pin?: string }
  | { type: 'leave' }
  | { type: 'text'; text: string }
  | { type: 'ping' }
  | {
      type: 'file-meta'
      fileId: string
      name: string
      size: number
      mimeType: string
      totalChunks: number
      chunkSize?: number
      binary?: boolean
      resume?: boolean
      encrypted?: boolean
    }
  | { type: 'file-status'; fileId: string; nextIndex: number }
  | { type: 'file-chunk'; fileId: string; index: number; data: string }
  | { type: 'file-cancel'; fileId: string }

export type ServerMessage =
  | { type: 'welcome'; peerId: string; room: unknown; peers: Peer[]; items: RoomItem[] }
  | { type: 'error'; message: string }
  | { type: 'peers'; peers: Peer[] }
  | { type: 'item'; item: RoomItem }
  | { type: 'items'; items: RoomItem[] }
  | { type: 'file-progress'; progress: FileProgress }
  | { type: 'file-status'; fileId: string; nextIndex: number }
  | { type: 'pong' }
  | { type: 'room-closed' }

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data.type !== 'string') return null
    return data as ClientMessage
  } catch {
    return null
  }
}
