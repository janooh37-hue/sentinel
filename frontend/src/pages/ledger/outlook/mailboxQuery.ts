/**
 * Pure `MailboxView` → list-query mapping for the Ledger Outlook shell.
 *
 * The shell drives a single list query off the active mailbox view. Personal
 * folders map to `GET /ledger` filters (`api.listLedger` params); a
 * Correspondence-Log category maps to `GET /ledger/log?category_id=`
 * (`api.getLedgerLog` params). `mailboxQuerySource` tells the shell which of the
 * two queries to run.
 *
 * Pure functions (no React, no I/O) so the routing is deterministic and unit-
 * tested — sibling to `mailboxTypes.ts`.
 */

import type { MailboxView } from './mailboxTypes'

/** Which endpoint a view queries: personal folders → `/ledger`, category → `/ledger/log`. */
export type MailboxQuerySource = 'ledger' | 'log'

/** Subset of `api.listLedger` params that a personal folder maps to. */
export type LedgerQueryParams = {
  direction?: 'incoming' | 'outgoing'
  tag?: string
  include_drafts?: boolean
  include_deleted?: boolean
}

/** Subset of `api.getLedgerLog` params that a log category maps to. */
export type LogQueryParams = {
  category_id?: number
}

/** Tells the list which query to run for the active view. */
export function mailboxQuerySource(view: MailboxView): MailboxQuerySource {
  return view.kind === 'log' ? 'log' : 'ledger'
}

/**
 * Map a personal folder to `GET /ledger` filters. Returns `{}` for a log view
 * (the list runs the log query instead — see `mailboxToLogParams`).
 */
export function mailboxToLedgerParams(view: MailboxView): LedgerQueryParams {
  if (view.kind === 'log') return {}
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
 * Map a Correspondence-Log category to `GET /ledger/log` params. `categoryId:
 * null` (all categories) and personal-folder views yield `{}`.
 */
export function mailboxToLogParams(view: MailboxView): LogQueryParams {
  if (view.kind !== 'log' || view.categoryId == null) return {}
  return { category_id: view.categoryId }
}
