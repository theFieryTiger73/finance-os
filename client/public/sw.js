const VERSION = 'fos-v4'
const SHELL = [ '/', '/index.html', '/manifest.webmanifest', '/icon.svg' ]

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION)
    await cache.addAll(SHELL).catch(() => {})
    self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))
    await self.clients.claim()
  })())
})

function isViteDev(url) {
  return url.pathname.startsWith('/@') || url.pathname.includes('node_modules') || url.pathname.includes('vite')
}

async function networkFirst(request) {
  const cache = await caches.open(VERSION)
  try {
    const res = await fetch(request)
    if (res && res.ok) cache.put(request, res.clone()).catch(() => {})
    return res
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached
    if (request.mode === 'navigate') {
      return (await cache.match('/')) || (await cache.match('/index.html')) || Response.error()
    }
    throw new Error('offline')
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION)
  const cached = await cache.match(request)
  if (cached) return cached
  try {
    const res = await fetch(request)
    if (res && res.ok) cache.put(request, res.clone()).catch(() => {})
    return res
  } catch {
    if (request.mode === 'navigate') {
      return (await cache.match('/')) || (await cache.match('/index.html')) || Response.error()
    }
    throw new Error('offline')
  }
}

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (isViteDev(url)) return
  if (url.pathname.startsWith('/api/')) return
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req))
    return
  }
  event.respondWith(cacheFirst(req))
})

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting()
})
