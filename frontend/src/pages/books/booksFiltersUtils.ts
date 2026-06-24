import type { BooksFilters } from './BooksFilterBar'

export const DEFAULT_BOOKS_FILTERS: BooksFilters = {
  categoryIds: [],
  direction: 'all',
  status: 'all',
  fromDate: '',
  toDate: '',
  q: '',
}

/**
 * Merge a stored (potentially stale) filters object over the current defaults
 * so any newly-added field always has a sane initial value for returning users
 * whose persisted object predates the field.
 */
export function normalizeFilters(stored: Partial<BooksFilters>): BooksFilters {
  return { ...DEFAULT_BOOKS_FILTERS, ...stored }
}
