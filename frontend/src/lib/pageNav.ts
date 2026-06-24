/**
 * Page-id ↔ route-path mapping for the legacy `onNavigate(page, id?)` seam used
 * by Dashboard + Ledger. Lives in its own module (not App.tsx) so App.tsx stays
 * a component-only file for react-refresh, and so `buildPagePath` is unit-testable
 * without importing the whole app tree.
 */

/** Page identifiers historically used by Dashboard + Ledger's `onNavigate`. */
export type Page =
  | 'dashboard'
  | 'employees'
  | 'application'
  | 'books'
  | 'leaves'
  | 'ledger'
  | 'settings'

export const PAGE_PATHS: Record<Page, string> = {
  dashboard: '/',
  employees: '/employees',
  application: '/application',
  books: '/books',
  leaves: '/leaves',
  ledger: '/ledger',
  settings: '/settings',
}

/**
 * Build an id-aware route path: employees/books deep-link to `/x/:id` when an id
 * is supplied, otherwise fall back to the coarse page path.
 */
export function buildPagePath(page: Page, id?: string): string {
  if (id) {
    if (page === 'employees') return `/employees/${encodeURIComponent(id)}`
    if (page === 'books') return `/books/${encodeURIComponent(id)}`
  }
  return PAGE_PATHS[page]
}
