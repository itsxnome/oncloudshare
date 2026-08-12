import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'

const CHUNK_SIZE = 64 * 1024

export { CHUNK_SIZE }

export type IncomingFile = {
  fileId: string
  name: string
  size: number
  mimeType: string
  totalChunks: number
  chunks: Map<number, Buffer>
  received: number
  from: string
  fromName: string
}

export class FileTransferAssembler {
  private incoming = new Map<string, IncomingFile>()

  start(meta: Omit<IncomingFile, 'chunks' | 'received'>): IncomingFile {
    const entry: IncomingFile = {
      ...meta,
      chunks: new Map(),
      received: 0,
    }
    this.incoming.set(meta.fileId, entry)
    return entry
  }

  addChunk(fileId: string, index: number, dataBase64: string): IncomingFile | null {
    const entry = this.incoming.get(fileId)
    if (!entry) return null
    if (entry.chunks.has(index)) return entry
    const buf = Buffer.from(dataBase64, 'base64')
    entry.chunks.set(index, buf)
    entry.received += buf.length
    return entry
  }

  isComplete(fileId: string): boolean {
    const entry = this.incoming.get(fileId)
    if (!entry) return false
    return entry.chunks.size >= entry.totalChunks
  }

  assemble(fileId: string): { buffer: Buffer; meta: IncomingFile } | null {
    const entry = this.incoming.get(fileId)
    if (!entry || !this.isComplete(fileId)) return null
    const parts: Buffer[] = []
    for (let i = 0; i < entry.totalChunks; i++) {
      const chunk = entry.chunks.get(i)
      if (!chunk) return null
      parts.push(chunk)
    }
    const buffer = Buffer.concat(parts)
    this.incoming.delete(fileId)
    return { buffer, meta: entry }
  }

  cancel(fileId: string) {
    this.incoming.delete(fileId)
  }

  get(fileId: string) {
    return this.incoming.get(fileId)
  }
}

export function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 180) || 'file'
}

export function uniquePath(dir: string, name: string): string {
  ensureDir(dir)
  const safe = safeFileName(name)
  let full = path.join(dir, safe)
  if (!fs.existsSync(full)) return full
  const ext = path.extname(safe)
  const base = path.basename(safe, ext)
  const suffix = randomBytes(3).toString('hex')
  full = path.join(dir, `${base}-${suffix}${ext}`)
  return full
}

export function writeBufferToFile(dir: string, name: string, buffer: Buffer): string {
  const dest = uniquePath(dir, name)
  fs.writeFileSync(dest, buffer)
  return dest
}

export function splitBuffer(buffer: Buffer, chunkSize = CHUNK_SIZE): Buffer[] {
  const chunks: Buffer[] = []
  for (let i = 0; i < buffer.length; i += chunkSize) {
    chunks.push(buffer.subarray(i, i + chunkSize))
  }
  return chunks.length ? chunks : [Buffer.alloc(0)]
}
