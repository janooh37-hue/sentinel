import type { BookRead } from '@/lib/api'
import type { BooksFilters } from './BooksFilterBar'

export const DEFAULT_BOOKS_FILTERS: BooksFilters = {
  categoryIds: [],
  direction: 'all',
  status: 'all',
  fromDate: '',
  toDate: '',
  q: '',
  drafts: false,
  serviceId: 'all',
}

/**
 * Merge a stored (potentially stale) filters object over the current defaults
 * so any newly-added field always has a sane initial value for returning users
 * whose persisted object predates the field.
 */
export function normalizeFilters(stored: Partial<BooksFilters>): BooksFilters {
  return { ...DEFAULT_BOOKS_FILTERS, ...stored }
}

/**
 * Mobile's client-side row predicate (BooksPage's `mobileRows`, unscoped
 * `allRows`). Service MUST gate before the drafts early-return: otherwise
 * "service X + drafts" would leak every service's drafts through here while
 * desktop (whose `allRows` is already server-scoped to the selected service)
 * shows only X's — the two surfaces disagreeing about the same filter combo
 * is exactly the bug this function's test guards against.
 */
export function matchesBookFilters(row: BookRead, filters: BooksFilters): boolean {
  if (filters.serviceId !== 'all' && row.service_id !== filters.serviceId) return false
  if (filters.drafts) return row.is_draft && !row.voided_at
  if (filters.categoryIds.length > 0 && !filters.categoryIds.includes(row.category_id)) return false
  if (filters.direction !== 'all' && row.direction !== filters.direction) return false
  if (filters.status !== 'all' && row.approval_state !== filters.status) return false
  const day = row.created_at.slice(0, 10)
  if (filters.fromDate && day < filters.fromDate) return false
  if (filters.toDate && day > filters.toDate) return false
  const q = filters.q.trim().toLowerCase()
  if (q && !`${row.ref_number} ${row.subject ?? ''}`.toLowerCase().includes(q)) return false
  return true
}

/**
 * Desktop's search-branch predicate (BooksPage's `desktopRows`, used only
 * when a debounced server search is active — that query is unscoped by
 * service, so it needs the same client guard the plain list branch gets for
 * free from its already-scoped `allRows`). Same ordering requirement as
 * `matchesBookFilters` above, for the same reason.
 */
export function matchesDesktopSearchRow(
  row: BookRead,
  scope: { railService: string; showDrafts: boolean; spineState: string },
): boolean {
  if (scope.railService !== 'all' && row.service_id !== scope.railService) return false
  if (scope.showDrafts) return row.is_draft && !row.voided_at
  if (scope.spineState !== 'all' && row.approval_state !== scope.spineState) return false
  return true
}
