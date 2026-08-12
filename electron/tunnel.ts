import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import { app } from 'electron'
import { ensureDir } from './server/file-transfer'

export type TunnelDetectResult = {
  ready: boolean
  path: string | null
  source: 'custom' | 'bundled' | 'userdata' | 'path' | 'common' | null
  installing?: boolean
  error?: string
}

const CLOUDFLARED_WIN_URL =
  'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'

function whichSync(cmd: string): string | null {
  try {
    const isWin = process.platform === 'win32'
    const result = execFileSync(isWin ? 'where' : 'which', [cmd], {
      encoding: 'utf8',
      windowsHide: true,
    })
    const first = result
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean)
    return first || null
  } catch {
    return null
  }
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const get = url.startsWith('https') ? https.get : http.get
    const request = get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        fs.unlinkSync(dest)
        downloadFile(res.headers.location, dest).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        file.close()
        reject(new Error(`Download failed (${res.statusCode})`))
        return
      }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
    })
    request.on('error', (err) => {
      try {
        file.close()
        fs.unlinkSync(dest)
      } catch {
        /* ignore */
      }
      reject(err)
    })
  })
}

export class TunnelManager {
  private proc: ChildProcessWithoutNullStreams | null = null
  private url: string | null = null
  private installing = false
  private onUnexpectedExit: ((code: number | null) => void) | null = null
  private stoppingIntentionally = false

  setUnexpectedExitHandler(handler: ((code: number | null) => void) | null) {
    this.onUnexpectedExit = handler
  }

  getUrl() {
    return this.url
  }

  isRunning() {
    return Boolean(this.proc && !this.proc.killed)
  }

  private userDataBin(): string {
    return path.join(app.getPath('userData'), 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
  }

  private commonPaths(): string[] {
    if (process.platform !== 'win32') {
      return ['/usr/local/bin/cloudflared', '/opt/homebrew/bin/cloudflared']
    }
    const localApp = process.env.LOCALAPPDATA || ''
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    return [
      path.join(localApp, 'cloudflared', 'cloudflared.exe'),
      path.join(programFiles, 'cloudflared', 'cloudflared.exe'),
      path.join(programFilesX86, 'cloudflared', 'cloudflared.exe'),
      path.join(process.env.USERPROFILE || '', 'scoop', 'shims', 'cloudflared.exe'),
    ]
  }

  detect(customPath?: string): TunnelDetectResult {
    const checks: Array<{ path: string; source: TunnelDetectResult['source'] }> = []

    if (customPath?.trim()) {
      checks.push({ path: customPath.trim(), source: 'custom' })
    }

    checks.push(
      {
        path: path.join(process.resourcesPath || '', 'resources', 'cloudflared.exe'),
        source: 'bundled',
      },
      {
        path: path.join(app.getAppPath(), 'resources', 'cloudflared.exe'),
        source: 'bundled',
      },
      { path: path.join(process.cwd(), 'resources', 'cloudflared.exe'), source: 'bundled' },
      { path: this.userDataBin(), source: 'userdata' },
    )

    for (const p of this.commonPaths()) {
      checks.push({ path: p, source: 'common' })
    }

    for (const c of checks) {
      try {
        if (c.path && fs.existsSync(c.path)) {
          return { ready: true, path: c.path, source: c.source }
        }
      } catch {
        /* ignore */
      }
    }

    const onPath = whichSync(process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
    if (onPath) {
      return { ready: true, path: onPath, source: 'path' }
    }

    return {
      ready: false,
      path: null,
      source: null,
      installing: this.installing,
    }
  }

  resolveCloudflared(customPath?: string): string | null {
    return this.detect(customPath).path
  }

  async ensureInstalled(customPath?: string): Promise<TunnelDetectResult> {
    const existing = this.detect(customPath)
    if (existing.ready) return existing

    if (process.platform !== 'win32') {
      return {
        ready: false,
        path: null,
        source: null,
        error: 'Install cloudflared (brew install cloudflared) then reopen OnCloudShare.',
      }
    }

    this.installing = true
    try {
      const dest = this.userDataBin()
      ensureDir(path.dirname(dest))
      const tmp = `${dest}.download`
      await downloadFile(CLOUDFLARED_WIN_URL, tmp)
      if (fs.existsSync(dest)) {
        try {
          fs.unlinkSync(dest)
        } catch {
          /* ignore */
        }
      }
      fs.renameSync(tmp, dest)
      this.installing = false
      return { ready: true, path: dest, source: 'userdata' }
    } catch (e) {
      this.installing = false
      return {
        ready: false,
        path: null,
        source: null,
        error: e instanceof Error ? e.message : 'Failed to download cloudflared',
      }
    }
  }

  async startQuickTunnel(
    localPort: number,
    cloudflaredPath?: string,
  ): Promise<{ ok: boolean; url?: string; error?: string }> {
    await this.stop()

    let detected = this.detect(cloudflaredPath)
    if (!detected.ready) {
      detected = await this.ensureInstalled(cloudflaredPath)
    }
    if (!detected.ready || !detected.path) {
      return {
        ok: false,
        error:
          detected.error ||
          'Could not set up remote access automatically. Check your internet connection and try again.',
      }
    }

    const bin = detected.path
    this.stoppingIntentionally = false

    return await new Promise((resolve) => {
      let settled = false
      const args = ['tunnel', '--url', `http://127.0.0.1:${localPort}`]
      try {
        this.proc = spawn(bin, args, { windowsHide: true })
      } catch (e) {
        resolve({
          ok: false,
          error: e instanceof Error ? e.message : 'Failed to start cloudflared',
        })
        return
      }

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          resolve({
            ok: false,
            error: 'Timed out waiting for remote link. Retry in a moment.',
          })
        }
      }, 30000)

      const handleData = (buf: Buffer) => {
        const text = buf.toString()
        const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
        if (match && !settled) {
          settled = true
          clearTimeout(timeout)
          this.url = match[0]
          resolve({ ok: true, url: this.url })
        }
      }

      this.proc.stdout.on('data', handleData)
      this.proc.stderr.on('data', handleData)
      this.proc.on('error', (err) => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          resolve({ ok: false, error: err.message })
        }
      })
      this.proc.on('exit', (code) => {
        const wasActive = Boolean(this.url)
        this.proc = null
        this.url = null
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          resolve({ ok: false, error: `Remote helper exited (${code ?? '?'})` })
          return
        }
        if (wasActive && !this.stoppingIntentionally) {
          this.onUnexpectedExit?.(code)
        }
      })
    })
  }

  async stop() {
    this.stoppingIntentionally = true
    if (this.proc) {
      try {
        this.proc.kill()
      } catch {
        /* ignore */
      }
      this.proc = null
    }
    this.url = null
  }
}
