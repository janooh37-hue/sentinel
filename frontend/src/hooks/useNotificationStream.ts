/**
 * useNotificationStream — shell-level SSE consumer. Mounted ONCE in App's Shell.
 *
 * Opens EventSource('/api/v1/notifications/stream') and writes each `counts`
 * frame into the ['notifications','counts'] cache. Whenever those counts
 * change — from the stream or the 5-minute safety poll — only the queries
 * behind the changed counts are refetched, and a browser Notification fires
 * for any count that ROSE. The first counts seen are a baseline.
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
const COUNTS_KEY = ['notifications', 'counts'] as const
const SAFETY_POLL_MS = 5 * 60_000 // fallback only; stream is the live path

type Key = keyof NotificationCounts

/** The cached queries each count stands for; only these refetch when it changes. */
const QUERIES_BY_COUNT: Record<Key, readonly (readonly string[])[]> = {
  approvals: [['books', 'approval-summary'], ['books', 'awaiting']],
  leaves: [['leaves-list', 'report-all']],
  scans: [['scan-inbox', 'count']],
  emails: [['ledger', 'unread-recent'], ['ledger-unread-count']],
  monthly_reviews: [['inmate-register', 'awaiting-close']],
  monthly_approvals: [['inmate-register', 'awaiting-close']],
}

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
  const { data: counts } = useQuery({
    queryKey: COUNTS_KEY,
    queryFn: () => api.getNotificationCounts(),
    refetchInterval: SAFETY_POLL_MS,
    staleTime: SAFETY_POLL_MS,
    enabled,
  })

  // Diff every new counts value (stream frame or poll) against the last one.
  useEffect(() => {
    if (!enabled) {
      // Next enable starts from a fresh baseline: no stale Notification.
      prevRef.current = null
      return
    }
    if (!counts) return
    const prev = prevRef.current
    prevRef.current = counts
    if (prev === null) return

    const changed = (Object.keys(QUERIES_BY_COUNT) as Key[]).filter((k) => counts[k] !== prev[k])
    const queryKeys = new Map(
      changed.flatMap((k) => QUERIES_BY_COUNT[k]).map((key) => [key.join('\u0000'), key]),
    )
    queryKeys.forEach((queryKey) => void qc.invalidateQueries({ queryKey }))

    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
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
      monthly_reviews: t('nav.bell.notify.monthlyReview'),
      monthly_approvals: t('nav.bell.notify.monthlyApproval'),
    }
    changed.forEach((k) => {
      if (counts[k] <= prev[k]) return
      try {
        new Notification(titles[k], { tag: `gssg-${k}` })
      } catch {
        // Ignore — Notification constructor can throw in restricted contexts.
      }
    })
  }, [counts, enabled, qc, t])

  useEffect(() => {
    if (!enabled) return

    let es: EventSource | null = null
    try {
      // same-origin → session cookie carried automatically
      es = new EventSource(STREAM_URL)
      es.addEventListener('counts', (e: MessageEvent) => {
        try {
          const next = JSON.parse(e.data as string) as NotificationCounts
          // Structural sharing keeps the old reference for an identical
          // frame, so the diff effect above only runs on a real change.
          qc.setQueryData(COUNTS_KEY, next)
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
  }, [enabled, qc])
}
