/**
 * Pure `MailboxView` → list-query mapping for the Ledger Outlook shell.
 *
 * The shell drives a single list query off the active mailbox view. Personal
 * folders map to `GET /ledger` filters (`api.listLedger` params); the
 * Follow-ups view maps to `flagged=true` (server-sorted by due).
 *
 * Pure functions (no React, no I/O) so the routing is deterministic and unit-
 * tested — sibling to `mailboxTypes.ts`.
 *
 * (The Correspondence-Log `{kind:'log'}` mapping was removed 2026-06-25.)
 */

import type { MailboxView } from './mailboxTypes'

/** Subset of `api.listLedger` params that a mailbox view maps to. */
export type LedgerQueryParams = {
  direction?: 'incoming' | 'outgoing'
  tag?: string
  include_drafts?: boolean
  include_deleted?: boolean
  /** Phase 2 (D1) quick filters + (D3b) follow-up view. */
  unread?: boolean
  has_attachments?: boolean
  flagged?: boolean
  employee_id?: string
  /** Phase 3 — a smart folder's saved subject filter, by folder id. */
  smart_folder_id?: number
}

/**
 * The quick-filter chip state (Phase 2, D1). A closed set of booleans, layered
 * on the open view's base params. `thisEmployee` only applies when an employee
 * G-number is in context (the shell passes it in).
 */
export interface QuickFilters {
  unread: boolean
  hasAttachment: boolean
  flagged: boolean
  thisEmployee: boolean
}

export const EMPTY_QUICK_FILTERS: QuickFilters = {
  unread: false,
  hasAttachment: false,
  flagged: false,
  thisEmployee: false,
}

/** True when no quick filter is active ("All"). */
export function noFiltersActive(f: QuickFilters): boolean {
  return !f.unread && !f.hasAttachment && !f.flagged && !f.thisEmployee
}

/** Map a mailbox view to `GET /ledger` filters. */
export function mailboxToLedgerParams(view: MailboxView): LedgerQueryParams {
  if (view.kind === 'followups') {
    // The current user's flagged entries — backend sorts by due when flagged.
    return { flagged: true }
  }
  if (view.kind === 'smart') {
    // A smart folder = its saved subject filter, resolved server-side by id.
    return { smart_folder_id: view.folderId }
  }
  switch (view.folder) {
    case 'inbox':
      return { direction: 'incoming' }
    case 'sent':
      return { direction: 'outgoing' }
    case 'starred':
      return { tag: 'starred' }
    case 'drafts':
      return { include_drafts: true, tag: 'draft' }
    case 'trash':
      return { include_deleted: true }
  }
}

/**
 * Layer the active quick filters onto a view's base params. `employeeId` is the
 * G-number to use for the "This employee" chip (only applied when both the chip
 * is on AND an employee is in context). Filters never remove the view's own
 * scoping — they only narrow it (so e.g. Sent + Flagged keeps `direction` AND
 * adds `flagged`).
 */
export function applyQuickFilters(
  base: LedgerQueryParams,
  filters: QuickFilters,
  employeeId: string | null,
): LedgerQueryParams {
  const next: LedgerQueryParams = { ...base }
  if (filters.unread) next.unread = true
  if (filters.hasAttachment) next.has_attachments = true
  if (filters.flagged) next.flagged = true
  if (filters.thisEmployee && employeeId) next.employee_id = employeeId
  return next
}
