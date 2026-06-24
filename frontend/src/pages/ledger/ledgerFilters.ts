/**
 * Ledger filter shape + defaults — sibling to `LedgerFilterBar.tsx`.
 *
 * Lives in its own file so react-refresh stays happy: `LedgerFilterBar.tsx`
 * only exports components; constants and types live here.
 */

import type { LedgerDirection, LedgerChannel } from '@/lib/api'

export interface LedgerFilters {
  direction: LedgerDirection | null
  channel: LedgerChannel | null
  fromDate: string
  toDate: string
  counterparty: string
  q: string
  tag: string
  // Phase 15 — quick filter chip flags
  hasAttachment: boolean
  thisWeek: boolean
  sentFromApp: boolean
  starred: boolean
  drafts: boolean
  /** ISO date — set by the "This week" chip toggle. Plain filter axis so
   * render code stays pure (no `Date.now()` during render). */
  since: string
}

export const DEFAULT_LEDGER_FILTERS: LedgerFilters = {
  direction: null,
  channel: null,
  fromDate: '',
  toDate: '',
  counterparty: '',
  q: '',
  tag: '',
  hasAttachment: false,
  thisWeek: false,
  sentFromApp: false,
  starred: false,
  drafts: false,
  since: '',
}

/** Compute the ISO date 7 days before today. Called only from event handlers,
 * not during render. */
export function thisWeekIsoDate(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}
