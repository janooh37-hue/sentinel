/**
 * useMarkReadOnOpen — fire-and-forget mark-read when opening an unread email
 * entry that lives in the Inbox. Invalidates the NavBell unread-recent + the
 * list view so the badge and any "unread" row styling refresh. Guarded so we
 * don't double-POST on re-renders of the same entry.
 *
 * Scope = `incoming` OR `internal`: intra-office mail (every party on the
 * operator's own domain) is classified `internal` by the sync and surfaces in
 * the Inbox alongside incoming mail (ledger_service.list_entries). It must be
 * markable-read too, otherwise an internal email stays unread-blue forever no
 * matter how often it's opened.
 *
 * Extracted from LedgerEntryDrawer (Phase 17 effect) so both the drawer and the
 * Phase-5 reading pane share one implementation.
 */

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { LedgerEntryRead } from '@/lib/api'

export function useMarkReadOnOpen(entry: LedgerEntryRead | undefined): void {
  const qc = useQueryClient()
  useEffect(() => {
    if (
      !entry ||
      entry.channel !== 'email' ||
      (entry.direction !== 'incoming' && entry.direction !== 'internal') ||
      entry.read_at != null
    ) {
      return
    }
    let active = true
    void api.markLedgerEntryRead(entry.id).then(() => {
      if (!active) return
      void qc.invalidateQueries({ queryKey: ['ledger', 'unread-recent'] })
      void qc.invalidateQueries({ queryKey: ['ledger-entry', entry.id] })
      void qc.invalidateQueries({ queryKey: ['ledger'] })
    })
    return () => {
      active = false
    }
  }, [entry, qc])
}
