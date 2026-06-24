// GSSG Manager service worker.
// Task 1: install/activate skeleton.
// Push handlers (Task 2) added below.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

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
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if ('focus' in c) {
          return c.navigate(url).catch(() => self.clients.openWindow(url)).then(() => c.focus())
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
