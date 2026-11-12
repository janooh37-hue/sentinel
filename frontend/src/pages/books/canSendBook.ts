import { isWriterOnlyGrade } from '@/components/books/grades'
import type { BookRead } from '@/lib/api'

type SendGateBook = Pick<BookRead, 'can_send' | 'grade' | 'created_by_user_id' | 'current_template_id' | 'metadata_only'>

/** A Ledger Book travels by its own chain; the server refuses a plain Send (LEDGER_BOOK_CHAIN_ONLY). */
export const LEDGER_BOOK_TEMPLATE = 'Ledger Book'

export function isLedgerBookRecord(book: Pick<BookRead, 'current_template_id'>): boolean {
  return book.current_template_id === LEDGER_BOOK_TEMPLATE
}

/**
 * The one rule for offering the generic "Submit for approval": the viewer holds
 * `books.submit`, may write the record, and it is not a Ledger Book (those are
 * approved only through their Branch chain, LEDGER_BOOK_CHAIN_ONLY).
 */
export function canSubmitRecord(book: Pick<BookRead, 'can_write' | 'current_template_id'>, hasSubmitCapability: boolean): boolean {
  return hasSubmitCapability && !!book.can_write && !isLedgerBookRecord(book)
}

/**
 * The one rule for offering "Send" on a record: the server allows it, the
 * record is readable, it is not a Ledger Book, and a writer-only grade (top
 * secret, addressee only) is sent by its creator alone. Every desktop and
 * mobile surface asks this so they cannot drift.
 */
export function canSendBook(book: SendGateBook, userId: number | undefined): boolean {
  if (!book.can_send || book.metadata_only || isLedgerBookRecord(book)) return false
  return !isWriterOnlyGrade(book.grade) || (userId !== undefined && book.created_by_user_id === userId)
}
