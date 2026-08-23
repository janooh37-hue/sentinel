/**
 * Page-id ↔ route-path mapping for the dashboard's legacy `onNavigate` seam.
 * Kept separate from App.tsx so the mapping remains unit-testable.
 */

/** Page identifiers historically used by the dashboard `onNavigate` callback. */
export type Page =
  | 'dashboard'
  | 'employees'
  | 'application'
  | 'books'
  | 'leaves'
  | 'settings'

export const PAGE_PATHS: Record<Page, string> = {
  dashboard: '/',
  employees: '/employees',
  application: '/application',
  books: '/books',
  leaves: '/leaves',
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
