/* Service worker mínimo: torna o Claude Web instalável no Android
   sem interceptar API, WebSocket ou o fluxo ao vivo. */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return
  event.respondWith(fetch(event.request))
})
