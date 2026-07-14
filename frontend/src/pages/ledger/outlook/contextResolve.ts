/**
 * contextResolve — pure (React-free) helpers for the "People in this email"
 * context panel (Phase 7, Task 1).
 *
 * The panel reads the OPEN email (`LedgerEntryRead`) and derives the set of
 * employees it is *about*: the structurally-linked `related_employee_id`
 * (set on compose Add-reference) comes first, then any G-numbers detected in
 * the email body (`extractGNumbers`, shared with the reading-pane suggestion
 * detector so the two can't drift). Deduped, order-preserving. The panel
 * renders one collapsed-by-default card per entry — no person is privileged.
 * No people → idle.
 *
 * These are pure derivations so they're unit-testable in isolation; the React
 * card (`ContextPersonCard`) consumes them.
 */

import { extractGNumbers } from '@/lib/employeeDetection'
import type { EmployeeRead, EmployeeStatsRead, LedgerEntryRead } from '@/lib/api'

/** The employees an open mail/record is about. */
export interface ResolvedPeople {
  /**
   * Every resolved G-number, order-preserving + deduped. The panel renders one
   * (collapsed-by-default) card per entry — no person is privileged.
   */
  ordered: string[]
  /**
   * First resolved G-number. `null` ⇒ idle. Retained for callers that key off
   * "is there anyone?"; the panel no longer renders this specially.
   */
  primary: string | null
  /** The rest (everyone after `primary`). Retained for back-compat. */
  siblings: string[]
}

/** Show a document-expiry warning when within this many days (Phase-B window). */
const EXPIRY_WINDOW_DAYS = 90

/**
 * Resolve the people an open email is about.
 *
 * `related_employee_id` (if present) is prepended so it leads, falling back to
 * body order otherwise. Dedupe is case-insensitive + order-preserving
 * (canonical upper-case G-number).
 */
export function resolvePeople(entry: LedgerEntryRead): ResolvedPeople {
  const fromLink = entry.related_employee_id ? [entry.related_employee_id] : []
  const fromBody = extractGNumbers(entry.notes_html ?? '')

  const seen = new Set<string>()
  const ordered: string[] = []
  for (const g of [...fromLink, ...fromBody]) {
    const normalised = g.toUpperCase()
    if (seen.has(normalised)) continue
    seen.add(normalised)
    ordered.push(normalised)
  }

  if (ordered.length === 0) return { ordered, primary: null, siblings: [] }
  return { ordered, primary: ordered[0], siblings: ordered.slice(1) }
}

/**
 * Whole days from today (local midnight) until an ISO date (negative = past).
 * The `YYYY-MM-DD` is parsed as local-date parts (not `new Date(iso)`, which
 * reads bare dates as UTC midnight and would skew the count by a day in
 * non-UTC timezones).
 */
function daysUntil(isoDate: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number)
  const target = new Date(y, m - 1, d)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

/** A surfaced document-expiry warning for the primary card. */
export interface ExpiryAlert {
  /** Which document is expiring — `'uae_id'` or `'passport'`. */
  docType: 'uae_id' | 'passport'
  daysRemaining: number
}

/**
 * The soonest of the Emirates-ID / passport expiry dates that falls within the
 * warning window (including already-expired), else `null`. The human label
 * (document name + days) is rendered i18n-side by the card, so no `lang` is
 * needed here — only the doc type + day count.
 */
export function expiryAlert(emp: EmployeeRead): ExpiryAlert | null {
  const candidates: ExpiryAlert[] = []
  if (emp.uae_id_expiry) {
    candidates.push({ docType: 'uae_id', daysRemaining: daysUntil(emp.uae_id_expiry) })
  }
  if (emp.passport_expiry) {
    candidates.push({ docType: 'passport', daysRemaining: daysUntil(emp.passport_expiry) })
  }
  const within = candidates.filter((c) => c.daysRemaining <= EXPIRY_WINDOW_DAYS)
  if (within.length === 0) return null
  return within.reduce((soonest, c) => (c.daysRemaining < soonest.daysRemaining ? c : soonest))
}

/**
 * Remaining leave balance as a plain string — `allowed − taken`, clamped to 0
 * (the API has no dedicated "balance" field; `stats` is already in the single
 * detail call, so no extra fetch).
 */
export function leaveBalanceLabel(stats: EmployeeStatsRead): string {
  const balance = stats.leaves_allowed_days - stats.leaves_taken_days
  return String(Math.max(0, balance))
}

/** Emoji prefix for a recent-activity row, by its unified kind. */
export function activityEmoji(
  kind: 'document' | 'leave' | 'violation' | 'ledger',
): string {
  switch (kind) {
    case 'document':
      return '📕'
    case 'leave':
      return '🏖️'
    case 'violation':
      return '⚠️'
    case 'ledger':
      return '✉️'
  }
}
