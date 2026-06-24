/**
 * useSyncStatus — polls `GET /email/sync/status` while the Ledger is mounted
 * and auto-refreshes the mailbox when a sync lands.
 *
 * Cadence: 30s idle, tightening to 2s while a sync (manual OR scheduler) is
 * running. When `last_synced_at` advances past the previously observed value,
 * the ledger list / unread-count / log queries are invalidated so new mail
 * appears without any user interaction. The 500-row list itself is never
 * polled — only this cheap status row.
 */

import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { api, type EmailSyncStatus } from '@/lib/api'

const IDLE_POLL_MS = 30_000
const SYNCING_POLL_MS = 2_000

export function useSyncStatus(): { status: EmailSyncStatus | undefined } {
  const queryClient = useQueryClient()
  const lastSeenRef = useRef<string | null>(null)

  const query = useQuery({
    queryKey: ['email-sync-status'],
    queryFn: () => api.getEmailSyncStatus(),
    refetchInterval: (q) => (q.state.data?.syncing ? SYNCING_POLL_MS : IDLE_POLL_MS),
    staleTime: 0,
  })

  const lastSyncedAt = query.data?.last_synced_at ?? null
  useEffect(() => {
    if (lastSyncedAt === null) return
    if (lastSeenRef.current !== null && lastSeenRef.current !== lastSyncedAt) {
      void queryClient.invalidateQueries({ queryKey: ['ledger'] })
      void queryClient.invalidateQueries({ queryKey: ['ledger-unread-count'] })
      void queryClient.invalidateQueries({ queryKey: ['ledger-log'] })
    }
    lastSeenRef.current = lastSyncedAt
  }, [lastSyncedAt, queryClient])

  return { status: query.data }
}
