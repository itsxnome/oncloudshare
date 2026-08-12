import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'

/** Larger chunks for LAN / multi‑GB transfers (binary WS frames). */
export const CHUNK_SIZE = 512 * 1024
/** Small chunks kept for legacy JSON/base64 mobile fallback. */
export const LEGACY_CHUNK_SIZE = 64 * 1024

export { CHUNK_SIZE as DEFAULT_CHUNK_SIZE }

const MAGIC = Buffer.from('OCSF')

export type TransferMeta = {
  fileId: string
  name: string
  size: number
  mimeType: string
  chunkSize: number
  totalChunks: number
  nextIndex: number
  received: number
  from: string
  fromName: string
  partialPath: string
  createdAt: number
}

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

/** Legacy in-memory assembler (small files / clipboard). */
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

/**
 * Disk-backed sequential assembler for multi‑GB transfers.
 * Writes each chunk at offset; meta.json enables resume after disconnect.
 */
export class DiskFileAssembler {
  private active = new Map<string, TransferMeta>()
  private fds = new Map<string, number>()

  constructor(private stagingDir: string) {
    ensureDir(stagingDir)
  }

  private metaPath(fileId: string) {
    return path.join(this.stagingDir, `${fileId}.meta.json`)
  }

  private partialPath(fileId: string) {
    return path.join(this.stagingDir, `${fileId}.partial`)
  }

  start(input: {
    fileId: string
    name: string
    size: number
    mimeType: string
    totalChunks: number
    chunkSize?: number
    from: string
    fromName: string
    resume?: boolean
  }): TransferMeta {
    const chunkSize = input.chunkSize || CHUNK_SIZE
    const metaFile = this.metaPath(input.fileId)
    const partial = this.partialPath(input.fileId)

    if (input.resume && fs.existsSync(metaFile) && fs.existsSync(partial)) {
      try {
        const existing = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as TransferMeta
        if (
          existing.size === input.size &&
          existing.chunkSize === chunkSize &&
          existing.name === input.name
        ) {
          const priorFd = this.fds.get(input.fileId)
          if (priorFd != null) fs.closeSync(priorFd)
          const fd = fs.openSync(partial, 'r+')
          this.fds.set(input.fileId, fd)
          this.active.set(input.fileId, existing)
          return existing
        }
      } catch {
        /* fall through to fresh start */
      }
    }

    ensureDir(this.stagingDir)
    const fd = fs.openSync(partial, 'w')
    // Pre-allocate on Windows when possible (best-effort)
    try {
      if (input.size > 0) fs.ftruncateSync(fd, input.size)
    } catch {
      /* ignore */
    }

    const meta: TransferMeta = {
      fileId: input.fileId,
      name: input.name,
      size: input.size,
      mimeType: input.mimeType,
      chunkSize,
      totalChunks: input.totalChunks,
      nextIndex: 0,
      received: 0,
      from: input.from,
      fromName: input.fromName,
      partialPath: partial,
      createdAt: Date.now(),
    }
    this.fds.set(input.fileId, fd)
    this.active.set(input.fileId, meta)
    this.persistMeta(meta)
    return meta
  }

  private persistMeta(meta: TransferMeta) {
    fs.writeFileSync(this.metaPath(meta.fileId), JSON.stringify(meta))
  }

  addChunk(fileId: string, index: number, data: Buffer): TransferMeta | null {
    const meta = this.active.get(fileId)
    const fd = this.fds.get(fileId)
    if (!meta || fd == null) return null

    // Sequential only for resume simplicity
    if (index < meta.nextIndex) return meta
    if (index > meta.nextIndex) return null

    const offset = index * meta.chunkSize
    fs.writeSync(fd, data, 0, data.length, offset)
    meta.nextIndex = index + 1
    meta.received = Math.min(meta.size, meta.received + data.length)
    this.persistMeta(meta)
    return meta
  }

  /** Accept legacy base64 chunks. */
  addChunkBase64(fileId: string, index: number, dataBase64: string): TransferMeta | null {
    return this.addChunk(fileId, index, Buffer.from(dataBase64, 'base64'))
  }

  isComplete(fileId: string): boolean {
    const meta = this.active.get(fileId)
    if (!meta) return false
    return meta.nextIndex >= meta.totalChunks && meta.received >= meta.size
  }

  /** Close fd, rename partial → final path in destDir. */
  finalize(fileId: string, destDir: string): { path: string; meta: TransferMeta } | null {
    const meta = this.active.get(fileId)
    const fd = this.fds.get(fileId)
    if (!meta || !this.isComplete(fileId)) return null
    if (fd != null) {
      try {
        fs.closeSync(fd)
      } catch {
        /* ignore */
      }
      this.fds.delete(fileId)
    }
    ensureDir(destDir)
    const dest = uniquePath(destDir, meta.name)
    fs.renameSync(meta.partialPath, dest)
    try {
      fs.unlinkSync(this.metaPath(fileId))
    } catch {
      /* ignore */
    }
    this.active.delete(fileId)
    return { path: dest, meta }
  }

  /** Keep as staging file for room sharing without loading into RAM. */
  finalizeInPlace(fileId: string): { path: string; meta: TransferMeta } | null {
    const meta = this.active.get(fileId)
    const fd = this.fds.get(fileId)
    if (!meta || !this.isComplete(fileId)) return null
    if (fd != null) {
      try {
        fs.closeSync(fd)
      } catch {
        /* ignore */
      }
      this.fds.delete(fileId)
    }
    const finalPath = path.join(this.stagingDir, `${fileId}-${safeFileName(meta.name)}`)
    fs.renameSync(meta.partialPath, finalPath)
    try {
      fs.unlinkSync(this.metaPath(fileId))
    } catch {
      /* ignore */
    }
    this.active.delete(fileId)
    return { path: finalPath, meta: { ...meta, partialPath: finalPath } }
  }

  getResumeIndex(fileId: string): number {
    return this.active.get(fileId)?.nextIndex ?? 0
  }

  get(fileId: string) {
    return this.active.get(fileId)
  }

  cancel(fileId: string) {
    const fd = this.fds.get(fileId)
    if (fd != null) {
      try {
        fs.closeSync(fd)
      } catch {
        /* ignore */
      }
      this.fds.delete(fileId)
    }
    const meta = this.active.get(fileId)
    this.active.delete(fileId)
    if (meta) {
      try {
        fs.unlinkSync(meta.partialPath)
      } catch {
        /* ignore */
      }
      try {
        fs.unlinkSync(this.metaPath(fileId))
      } catch {
        /* ignore */
      }
    }
  }

  clear() {
    for (const id of [...this.active.keys()]) this.cancel(id)
  }
}

/** Encode binary file-chunk frame for WebSocket. */
export function encodeChunkFrame(fileId: string, index: number, data: Buffer): Buffer {
  const idBuf = Buffer.from(fileId, 'utf8')
  if (idBuf.length > 255) throw new Error('fileId too long')
  const header = Buffer.alloc(8 + idBuf.length)
  MAGIC.copy(header, 0)
  header.writeUInt8(1, 4) // version
  header.writeUInt8(1, 5) // type: chunk
  header.writeUInt8(idBuf.length, 6)
  header.writeUInt8(0, 7) // reserved
  idBuf.copy(header, 8)
  const indexBuf = Buffer.alloc(4)
  indexBuf.writeUInt32BE(index, 0)
  return Buffer.concat([header, indexBuf, data])
}

export function decodeChunkFrame(
  buf: Buffer,
): { fileId: string; index: number; data: Buffer } | null {
  if (buf.length < 12 || buf.subarray(0, 4).compare(MAGIC) !== 0) return null
  const version = buf.readUInt8(4)
  const type = buf.readUInt8(5)
  if (version !== 1 || type !== 1) return null
  const idLen = buf.readUInt8(6)
  const idStart = 8
  const idEnd = idStart + idLen
  if (buf.length < idEnd + 4) return null
  const fileId = buf.subarray(idStart, idEnd).toString('utf8')
  const index = buf.readUInt32BE(idEnd)
  const data = buf.subarray(idEnd + 4)
  return { fileId, index, data }
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

export async function streamFileToCallback(
  filePath: string,
  chunkSize: number,
  onChunk: (index: number, data: Buffer) => Promise<void> | void,
  shouldAbort?: () => boolean,
): Promise<number> {
  const stat = fs.statSync(filePath)
  const totalChunks = Math.ceil(stat.size / chunkSize) || 1
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(chunkSize)
    for (let i = 0; i < totalChunks; i++) {
      if (shouldAbort?.()) throw new Error('cancelled')
      const offset = i * chunkSize
      const toRead = Math.min(chunkSize, stat.size - offset)
      const read = fs.readSync(fd, buf, 0, toRead, offset)
      await onChunk(i, Buffer.from(buf.subarray(0, read)))
    }
  } finally {
    fs.closeSync(fd)
  }
  return totalChunks
}
