/**
 * Record delete guard — the client mirror of the server's `is_deletable`
 * (books.py / book_service.delete_book, which answers 409 otherwise).
 *
 * A record is deletable iff it is not voided, its `approval_state` is one of
 * none / returned / rejected, and it has no active Word edit session (deleting
 * under a live WebDAV session would orphan the session). On top of that the
 * caller needs `books.delete` and a full-access, non-inmate-reporter view.
 *
 * UI contract: `noCapability` / `restricted` hide the delete control;
 * `inFlight` / `wordSession` show it disabled with the reason (`deleteReasonKey`).
 */
import type { BookRead } from '@/lib/api'

export type DeleteBlockReason = 'noCapability' | 'restricted' | 'inFlight' | 'wordSession'

/** The fields the guard reads; satisfied by `BookRead`. */
export type DeletableBook = Pick<
  BookRead,
  'approval_state' | 'access_scope' | 'voided_at' | 'edit_session'
>

const DELETABLE_STATES: Readonly<Record<string, true>> = {
  none: true,
  returned: true,
  rejected: true,
}

/**
 * Why `book` cannot be deleted by this user, or `null` when it can.
 * Order: noCapability, restricted, inFlight, wordSession.
 */
export function deleteBlockReason(
  book: DeletableBook,
  { has, isInmateReporter }: { has: (cap: string) => boolean; isInmateReporter: boolean },
): DeleteBlockReason | null {
  if (!has('books.delete')) return 'noCapability'
  if (isInmateReporter || book.access_scope !== 'full') return 'restricted'
  if (book.voided_at || !DELETABLE_STATES[book.approval_state]) return 'inFlight'
  if (book.edit_session?.state === 'active') return 'wordSession'
  return null
}

/**
 * i18n key explaining a disabled delete control. `null` for the reasons that
 * hide the control instead (`noCapability`, `restricted`).
 */
export function deleteReasonKey(
  reason: DeleteBlockReason | null,
): 'books.reason.inFlight' | 'books.reason.wordSession' | null {
  if (reason === 'inFlight') return 'books.reason.inFlight'
  if (reason === 'wordSession') return 'books.reason.wordSession'
  return null
}
