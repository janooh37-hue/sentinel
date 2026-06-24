/**
 * Pure helper for resolving a Book's backing PDF document.
 *
 * The book-level `doc_id` on `BookRead` is a legacy placeholder that the backend
 * leaves `null` ("always None for now", `schemas/book.py`). The real document
 * lives on the book's **current version** — the one with the highest
 * `version_no` (the `versions` relationship is ordered ascending). This mirrors
 * how `BookRecordPage` derives its preview URL (`versions[last].document_id`).
 *
 * Returns the current version's `document_id`, or `undefined` when the book has
 * no versions or its current version has no generated document yet.
 */

type VersionLike = { version_no: number; document_id?: number | null }

export function currentBookDocId(book: {
  versions?: VersionLike[] | null
}): number | undefined {
  const versions = book.versions ?? []
  if (versions.length === 0) return undefined
  const current = versions.reduce((a, b) => (b.version_no >= a.version_no ? b : a))
  return current.document_id ?? undefined
}
