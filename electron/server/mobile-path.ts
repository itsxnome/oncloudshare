import path from 'path'
import fs from 'fs'

function mobileCandidates(fileName: string): string[] {
  return [
    path.join(process.resourcesPath || '', 'resources', 'mobile', fileName),
    path.join(process.resourcesPath || '', 'mobile', fileName),
    path.join(process.cwd(), 'resources', 'mobile', fileName),
    path.join(__dirname, 'mobile', fileName),
    path.join(__dirname, '..', '..', 'resources', 'mobile', fileName),
    path.join(__dirname, '..', '..', 'electron', 'server', 'mobile', fileName),
  ]
}

export function resolveMobileFile(fileName: string): string | null {
  for (const c of mobileCandidates(fileName)) {
    try {
      if (c && fs.existsSync(c)) return c
    } catch {
      /* ignore */
    }
  }
  return null
}

export function resolveMobileIndex(): string | null {
  return resolveMobileFile('index.html')
}
