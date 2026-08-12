import type { FileProgress } from '../shared/types'

export type TransferDirection = 'upload' | 'download'

type InternalTransfer = {
  fileId: string
  name: string
  total: number
  received: number
  status: FileProgress['status']
  direction: TransferDirection
  paused: boolean
  cancelled: boolean
  error?: string
  waiters: Array<() => void>
}

export class TransferController {
  private transfers = new Map<string, InternalTransfer>()

  constructor(private onProgress: (p: FileProgress) => void) {}

  list(): FileProgress[] {
    return Array.from(this.transfers.values()).map((t) => this.toProgress(t))
  }

  get(fileId: string) {
    const t = this.transfers.get(fileId)
    return t ? this.toProgress(t) : null
  }

  start(opts: {
    fileId: string
    name: string
    total: number
    direction: TransferDirection
  }) {
    const existing = this.transfers.get(opts.fileId)
    if (existing && (existing.status === 'paused' || existing.status === 'uploading' || existing.status === 'downloading')) {
      existing.cancelled = false
      existing.paused = false
      existing.status = opts.direction === 'upload' ? 'uploading' : 'downloading'
      this.emit(existing)
      return
    }
    const t: InternalTransfer = {
      fileId: opts.fileId,
      name: opts.name,
      total: opts.total,
      received: existing?.received || 0,
      status: opts.direction === 'upload' ? 'uploading' : 'downloading',
      direction: opts.direction,
      paused: false,
      cancelled: false,
      waiters: [],
    }
    this.transfers.set(opts.fileId, t)
    this.emit(t)
  }

  setReceived(fileId: string, received: number) {
    const t = this.transfers.get(fileId)
    if (!t || t.cancelled) return
    t.received = received
    if (!t.paused) {
      t.status = t.direction === 'upload' ? 'uploading' : 'downloading'
    }
    this.emit(t)
  }

  async waitIfPaused(fileId: string): Promise<boolean> {
    const t = this.transfers.get(fileId)
    if (!t) return false
    if (t.cancelled) return false
    while (t.paused && !t.cancelled) {
      await new Promise<void>((resolve) => {
        t.waiters.push(resolve)
      })
    }
    return !t.cancelled
  }

  isCancelled(fileId: string) {
    return Boolean(this.transfers.get(fileId)?.cancelled)
  }

  isPaused(fileId: string) {
    return Boolean(this.transfers.get(fileId)?.paused)
  }

  pause(fileId: string): boolean {
    const t = this.transfers.get(fileId)
    if (!t) return false
    if (t.status !== 'uploading' && t.status !== 'downloading' && t.status !== 'paused') {
      return false
    }
    t.paused = true
    t.status = 'paused'
    this.emit(t)
    return true
  }

  resume(fileId: string): boolean {
    const t = this.transfers.get(fileId)
    if (!t || t.cancelled) return false
    if (t.status !== 'paused' && !t.paused) return false
    t.paused = false
    t.status = t.direction === 'upload' ? 'uploading' : 'downloading'
    const waiters = t.waiters.splice(0, t.waiters.length)
    for (const w of waiters) w()
    this.emit(t)
    return true
  }

  cancel(fileId: string): boolean {
    const t = this.transfers.get(fileId)
    if (!t) return false
    t.cancelled = true
    t.paused = false
    t.status = 'cancelled'
    const waiters = t.waiters.splice(0, t.waiters.length)
    for (const w of waiters) w()
    this.emit(t)
    return true
  }

  complete(fileId: string, received?: number) {
    const t = this.transfers.get(fileId)
    if (!t) return
    t.received = received ?? t.total
    t.status = 'done'
    t.paused = false
    this.emit(t)
  }

  fail(fileId: string, error: string) {
    const t = this.transfers.get(fileId)
    if (!t) {
      this.onProgress({
        fileId,
        name: 'file',
        received: 0,
        total: 0,
        status: 'error',
        error,
      })
      return
    }
    t.status = 'error'
    t.error = error
    t.paused = false
    const waiters = t.waiters.splice(0, t.waiters.length)
    for (const w of waiters) w()
    this.emit(t)
  }

  clearFinished() {
    for (const [id, t] of this.transfers) {
      if (t.status === 'done' || t.status === 'error' || t.status === 'cancelled') {
        this.transfers.delete(id)
      }
    }
  }

  private toProgress(t: InternalTransfer): FileProgress {
    return {
      fileId: t.fileId,
      name: t.name,
      received: t.received,
      total: t.total,
      status: t.status,
      error: t.error,
      direction: t.direction,
      canPause: t.status === 'uploading' || t.status === 'downloading' || t.status === 'paused',
    }
  }

  private emit(t: InternalTransfer) {
    this.onProgress(this.toProgress(t))
  }
}
