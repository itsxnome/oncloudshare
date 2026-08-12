import Store from 'electron-store'
import path from 'path'
import { app } from 'electron'
import os from 'os'
import type { AppSettings } from './shared/types'

const defaults: AppSettings = {
  displayName: os.hostname() || 'OnCloudShare PC',
  downloadFolder: path.join(app.getPath('downloads'), 'OnCloudShare'),
  preferredPort: 47891,
  pin: '',
  startOnBoot: false,
  tunnelMode: 'none',
  manualTunnelUrl: '',
  cloudflaredPath: '',
  firstRunDone: false,
  autoRemoteOnCreate: true,
  maxFileSizeMb: 2048,
}

export function createSettingsStore() {
  const store = new Store<AppSettings>({
    name: 'settings',
    defaults,
  })

  return {
    get(): AppSettings {
      return { ...defaults, ...store.store }
    },
    set(partial: Partial<AppSettings>): AppSettings {
      store.set(partial)
      return this.get()
    },
  }
}
