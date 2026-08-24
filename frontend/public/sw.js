// GSSG Manager service worker.
// Task 1: install/activate skeleton.
// Push handlers (Task 2) added below.

self.addEventListener('install', () => self.skipWaiting())

// Hashed build assets (/assets/*) are content-addressed and immutable, so
// they are cached cache-first under a versioned name. Everything else —
// navigations, /api/ — falls through to the network untouched.
const ASSETS_CACHE = 'gssg-assets-v1'

self.addEventListener('activate', (e) =>
  e.waitUntil(
    (async () => {
      // Drop asset caches from older SW versions so stale chunks can't pile up.
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => k.startsWith('gssg-assets-') && k !== ASSETS_CACHE)
          .map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  ),
)

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith('/assets/')
  ) {
    return // no respondWith — the request proceeds as if the SW weren't here
  }
  event.respondWith(
    (async () => {
      const hit = await caches.match(event.request)
      if (hit) return hit
      const response = await fetch(event.request)
      // Only cache real successes: opaque/error responses would poison an
      // immutable-URL cache until the version bumps.
      if (response.ok) {
        const cache = await caches.open(ASSETS_CACHE)
        await cache.put(event.request, response.clone())
      }
      return response
    })(),
  )
})

// --- Push handlers (Task 2) ---
self.addEventListener('push', (event) => {
  let data = { title: 'GSSG Manager', body: '', url: '/' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch (_e) {
    /* keep defaults */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // Prefer routing inside an already-open app window: focus it and let
      // React Router navigate client-side. `WindowClient.navigate()` is
      // unreliable in iOS standalone PWAs (it can land on a blank page), so we
      // postMessage instead and only fall back to a full load when no window
      // is open.
      for (const c of cs) {
        if ('focus' in c) {
          await c.focus()
          c.postMessage({ type: 'notification-navigate', url })
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
