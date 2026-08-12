/**
 * Downloads cloudflared into resources/ for bundling with the Windows installer.
 * Safe to re-run; skips if the file already exists unless FORCE=1.
 */
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

const DEST = path.join(__dirname, '..', 'resources', 'cloudflared.exe')
const URL =
  'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const get = url.startsWith('https') ? https.get : http.get
    get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        fs.unlinkSync(dest)
        download(res.headers.location, dest).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        file.close()
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
    }).on('error', (err) => {
      try {
        file.close()
        fs.unlinkSync(dest)
      } catch {}
      reject(err)
    })
  })
}

async function main() {
  if (process.platform !== 'win32' && !process.env.FORCE_CLOUDFLARED_WIN) {
    console.log('Skipping cloudflared bundle (not Windows).')
    return
  }
  fs.mkdirSync(path.dirname(DEST), { recursive: true })
  if (fs.existsSync(DEST) && !process.env.FORCE) {
    console.log('cloudflared already present at', DEST)
    return
  }
  const tmp = DEST + '.download'
  console.log('Downloading cloudflared…')
  await download(URL, tmp)
  if (fs.existsSync(DEST)) fs.unlinkSync(DEST)
  fs.renameSync(tmp, DEST)
  console.log('Saved', DEST, `(${(fs.statSync(DEST).size / 1024 / 1024).toFixed(1)} MB)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
