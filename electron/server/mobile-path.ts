import path from 'path'
import fs from 'fs'

export function resolveMobileIndex(): string | null {
  const candidates = [
    path.join(process.resourcesPath || '', 'resources', 'mobile', 'index.html'),
    path.join(process.resourcesPath || '', 'mobile', 'index.html'),
    path.join(process.cwd(), 'resources', 'mobile', 'index.html'),
    path.join(__dirname, 'mobile', 'index.html'),
    path.join(__dirname, '..', '..', 'resources', 'mobile', 'index.html'),
    path.join(__dirname, '..', '..', 'electron', 'server', 'mobile', 'index.html'),
  ]
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c
    } catch {
      /* ignore */
    }
  }
  return null
}
