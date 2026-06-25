/**
 * PWA service worker registration + Web Push subscription helpers.
 *
 * Task 1: registerServiceWorker() — no-op outside secure contexts.
 * Task 2: subscribeToPush() / unsubscribeFromPush() — VAPID Web Push.
 */

import { api } from './api'

// ---------------------------------------------------------------------------
// Service-worker registration (Task 1)
// ---------------------------------------------------------------------------

/**
 * Registers /sw.js when supported AND in a secure context (HTTPS or localhost).
 * No-op otherwise (plain http:// LAN won't work — see Phase 5 runbook).
 * Returns the registration or null.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  if (!window.isSecureContext) return null // SW requires HTTPS or localhost
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Web Push subscription helpers (Task 2)
// ---------------------------------------------------------------------------

/**
 * The device's current UI language ('en'|'ar'), read from the same source
 * i18next uses (localStorage `gssg.lang`, then `navigator.language`). Sent to
 * the backend at subscribe time so pushes to this device are localized.
 */
function currentLocale(): 'en' | 'ar' {
  try {
    const stored = window.localStorage.getItem('gssg.lang')
    if (stored?.toLowerCase().startsWith('ar')) return 'ar'
    if (stored?.toLowerCase().startsWith('en')) return 'en'
  } catch {
    /* localStorage unavailable (private mode) — fall through to navigator */
  }
  return (navigator.language || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en'
}

function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
  return arr.buffer as ArrayBuffer
}

/**
 * Request notification permission, subscribe to Web Push, and POST the
 * subscription to the backend. Returns the subscription or null on denial /
 * unavailability.
 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  const reg = await registerServiceWorker()
  if (!reg) return null
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return null
  const { public_key } = await api.getVapidPublicKey()
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(public_key),
  })
  const json = sub.toJSON()
  await api.subscribePush({
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth },
    locale: currentLocale(),
  })
  return sub
}

/**
 * Unsubscribe from Web Push and notify the backend so the row is pruned.
 */
export async function unsubscribeFromPush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await api.unsubscribePush(sub.endpoint).catch(() => {})
    await sub.unsubscribe()
  }
}
