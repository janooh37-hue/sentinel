/**
 * useNotificationStream — shell-level SSE consumer. Mounted ONCE in App's Shell.
 *
 * Opens EventSource('/api/v1/notifications/stream'); on each `counts` event it
 * invalidates the react-query keys behind the bell's four signals and fires a
 * browser Notification for any count that ROSE since the last frame. A
 * low-frequency safety poll keeps the bell fresh if the stream disconnects.
 *
 * Only active when `enabled` is true — pass `status === 'authed'` from Shell
 * to avoid opening the stream before the session resolves.
 *
 * Mirrors the invalidation half of pages/ledger/outlook/useSyncStatus.ts, but
 * shell-level and event-driven instead of polled.
 */

import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api, type NotificationCounts } from '@/lib/api'
import { subscribeToPush } from '@/lib/push'

const STREAM_URL = '/api/v1/notifications/stream'
const SAFETY_POLL_MS = 120_000 // fallback only; stream is the live path

type Key = keyof NotificationCounts

export function useNotificationStream(enabled = true): void {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const prevRef = useRef<NotificationCounts | null>(null)

  // One-time permission request (never re-prompt on 'denied').
  // After the browser grants permission, also register a Web Push subscription
  // so the backend can send push notifications when the tab is closed.
  // Only active under HTTPS (window.isSecureContext) — subscribeToPush is a
  // no-op otherwise. Errors are logged and never propagated.
  useEffect(() => {
    if (!enabled) return
    if (typeof Notification === 'undefined') return
    const swAvailable = 'serviceWorker' in navigator && navigator.serviceWorker != null
    if (Notification.permission !== 'default') {
      // Already decided — if already granted, try to subscribe (idempotent).
      if (Notification.permission === 'granted' && window.isSecureContext && swAvailable) {
        void subscribeToPush().catch((err: unknown) => {
          console.warn('[push] subscribe failed:', err)
        })
      }
      return
    }
    void Notification.requestPermission().then((perm) => {
      if (perm === 'granted' && window.isSecureContext && swAvailable) {
        void subscribeToPush().catch((err: unknown) => {
          console.warn('[push] subscribe failed:', err)
        })
      }
    })
  }, [enabled])

  // Safety poll — low frequency; stream does the real-time work.
  useQuery({
    queryKey: ['notifications', 'counts'],
    queryFn: () => api.getNotificationCounts(),
    refetchInterval: SAFETY_POLL_MS,
    staleTime: SAFETY_POLL_MS,
    enabled,
  })

  useEffect(() => {
    if (!enabled) return

    // Reset the baseline whenever (re)enabled so the first frame of a new
    // stream is always treated as the baseline — prevents a stale prevRef
    // from firing a Notification if a count rose during the disabled window.
    prevRef.current = null

    let es: EventSource | null = null

    const invalidate = (): void => {
      void qc.invalidateQueries({ queryKey: ['books', 'awaiting'] })
      void qc.invalidateQueries({ queryKey: ['leaves-list', 'report-all'] })
      void qc.invalidateQueries({ queryKey: ['scan-inbox', 'count'] })
      void qc.invalidateQueries({ queryKey: ['ledger', 'unread-recent'] })
      void qc.invalidateQueries({ queryKey: ['ledger'] })
      void qc.invalidateQueries({ queryKey: ['ledger-unread-count'] })
      void qc.invalidateQueries({ queryKey: ['ledger-log'] })
      void qc.invalidateQueries({ queryKey: ['notifications', 'counts'] })
    }

    const notifyFor = (next: NotificationCounts): void => {
      const prev = prevRef.current
      if (prev === null) {
        // Baseline frame — never fire a Notification on first event.
        prevRef.current = next
        return
      }
      const titles: Record<Key, string> = {
        approvals: t('nav.bell.notify.approval', {
          defaultValue: 'A document needs your approval',
        }),
        leaves: t('nav.bell.notify.leave', {
          defaultValue: 'A leave request needs action',
        }),
        scans: t('nav.bell.notify.scan', {
          defaultValue: 'A scan was attached to a record',
        }),
        emails: t('nav.bell.notify.email', {
          defaultValue: 'New email in your inbox',
        }),
      }
      ;(['approvals', 'leaves', 'scans', 'emails'] as Key[]).forEach((k) => {
        if (
          next[k] > prev[k] &&
          typeof Notification !== 'undefined' &&
          Notification.permission === 'granted'
        ) {
          try {
            new Notification(titles[k], { tag: `gssg-${k}` })
          } catch {
            // Ignore — Notification constructor can throw in restricted contexts.
          }
        }
      })
      prevRef.current = next
    }

    try {
      // same-origin → session cookie carried automatically
      es = new EventSource(STREAM_URL)
      es.addEventListener('counts', (e: MessageEvent) => {
        try {
          const next = JSON.parse(e.data as string) as NotificationCounts
          invalidate()
          notifyFor(next)
        } catch {
          // Malformed SSE frame — ignore and wait for the next.
        }
      })
      // EventSource auto-reconnects on transient drops; the safety poll covers
      // a hard failure where it can't reconnect.
    } catch {
      es = null
    }

    return () => {
      es?.close()
    }
  }, [enabled, qc, t])
}
