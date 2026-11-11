/** React Query keys and desk links shared by the Ledger Book components. */
export const LEDGER_DRAFTS_KEY = ['ledger', 'drafts'] as const

export const ledgerDraftKey = (id: number) => ['ledger', 'drafts', id] as const

/** Every cached query of one issued book (all Revisions). */
export const ledgerBookPrefix = (id: number) => ['ledger', 'books', id] as const

export const ledgerBookKey = (id: number, revision?: number) =>
  [...ledgerBookPrefix(id), revision ?? 'latest'] as const

/** The issued book opened on the Books desk. */
export const deskBookUrl = (bookId: number) => `/ledger?tab=books&book=${bookId}`

/** `revision` is a Revision's `version_id`. */
export function ledgerPaperUrl(source: { bookId: number; revision?: number }): string {
  const query = source.revision === undefined ? '' : `?revision=${source.revision}`
  return `/api/v1/ledger/books/${source.bookId}/paper${query}`
}
