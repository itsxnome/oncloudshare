/* Keeps the mobile join page warm and helps Android resume after the tab sleeps. */
const CACHE = 'ocs-mobile-v1'
const ASSETS = ['/', '/m', '/mobile']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.pathname === '/ws') return
  if (url.pathname.startsWith('/files/') || url.pathname === '/upload') return

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone()
        if (res.ok && (url.pathname === '/' || url.pathname === '/m' || url.pathname === '/mobile' || url.pathname === '/sw.js')) {
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {})
        }
        return res
      })
      .catch(async () => {
        const cached = await caches.match(req)
        if (cached) return cached
        if (url.pathname === '/' || url.pathname === '/m' || url.pathname === '/mobile') {
          return caches.match('/')
        }
        throw new Error('offline')
      }),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'ping') {
    event.source && event.source.postMessage({ type: 'pong' })
  }
})
