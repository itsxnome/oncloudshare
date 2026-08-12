import { Bonjour, type Service } from 'bonjour-service'
import type { DiscoveredRoom } from '../shared/types'

const SERVICE_TYPE = 'oncloudshare'

export class DiscoveryService {
  private bonjour: Bonjour | null = null
  private published: Service | null = null
  private browser: ReturnType<Bonjour['find']> | null = null
  private rooms = new Map<string, DiscoveredRoom>()
  private onChange: ((rooms: DiscoveredRoom[]) => void) | null = null

  start() {
    if (this.bonjour) return
    this.bonjour = new Bonjour()
    this.browser = this.bonjour.find({ type: SERVICE_TYPE })
    this.browser.on('up', (service: Service) => {
      const host = service.referer?.address || service.host
      const port = service.port
      const code = (service.txt?.code as string) || ''
      const roomName = (service.txt?.room as string) || service.name
      const hostName = (service.txt?.hostName as string) || service.name
      if (!host || !port || !code) return
      const key = `${code}@${host}:${port}`
      this.rooms.set(key, {
        name: roomName,
        code,
        host,
        port,
        hostName,
      })
      this.emit()
    })
    this.browser.on('down', (service: Service) => {
      const host = service.referer?.address || service.host
      const port = service.port
      const code = (service.txt?.code as string) || ''
      const key = `${code}@${host}:${port}`
      this.rooms.delete(key)
      this.emit()
    })
  }

  publish(opts: {
    name: string
    port: number
    code: string
    roomName: string
    hostName: string
  }) {
    this.start()
    this.unpublish()
    if (!this.bonjour) return
    this.published = this.bonjour.publish({
      name: opts.name,
      type: SERVICE_TYPE,
      port: opts.port,
      txt: {
        code: opts.code,
        room: opts.roomName,
        hostName: opts.hostName,
      },
    })
  }

  unpublish() {
    if (this.published) {
      try {
        this.published.stop()
      } catch {
        /* ignore */
      }
      this.published = null
    }
  }

  list(): DiscoveredRoom[] {
    return Array.from(this.rooms.values())
  }

  onRoomsChanged(cb: (rooms: DiscoveredRoom[]) => void) {
    this.onChange = cb
  }

  private emit() {
    this.onChange?.(this.list())
  }

  stop() {
    this.unpublish()
    if (this.browser) {
      try {
        this.browser.stop()
      } catch {
        /* ignore */
      }
      this.browser = null
    }
    if (this.bonjour) {
      try {
        this.bonjour.destroy()
      } catch {
        /* ignore */
      }
      this.bonjour = null
    }
    this.rooms.clear()
  }
}
