/**
 * Route-chunk prefetch on nav intent (hover/focus). Calls the same dynamic
 * import the route's `lazy()` will use, so the chunk is already in Vite's
 * module cache when the user clicks — the Suspense fallback never flashes.
 */

import {
  loadAccessRequestsPage,
  loadApplicationPage,
  loadApprovalsPage,
  loadAttendancePage,
  loadBookRecordPage,
  loadBooksPage,
  loadDashboardPage,
  loadDutyLocationsPage,
  loadEmployeeDetailPage,
  loadEmployeesOrgTreePage,
  loadExpiryPage,
  loadIntakePage,
  loadLeavesPage,
  loadLedgerPage,
  loadPermitsPage,
  loadVehicleAccidentsPage,
  loadVehicleDetailPage,
  loadVehicleFinesReportPage,
  loadVehicleMaintenancePage,
  loadVehiclesHubPage,
  loadScanBackPage,
  loadScanInboxPage,
  loadSendToGroupPage,
  loadSettingsPage,
  loadTimesheetPage,
} from '@/lib/routeLoaders'

/** First-segment route prefixes → chunk loader. Checked with startsWith so
 * deep links (`/books/:id`, `/employees/timesheet`) resolve to their page. */
const ROUTE_LOADERS: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  ['/', loadDashboardPage],
  ['/employees/attendance', loadAttendancePage],
  ['/employees/org-tree', loadEmployeesOrgTreePage],
  ['/employees/timesheet', loadTimesheetPage],
  ['/employees/', loadEmployeeDetailPage],
  // /employees itself is eagerly bundled (EmployeeLookupPage) — no prefetch.
  ['/application', loadApplicationPage],
  ['/books/approvals', loadApprovalsPage],
  ['/books/', loadBookRecordPage],
  ['/books', loadBooksPage],
  ['/scan-back', loadScanBackPage],
  ['/leaves', loadLeavesPage],
  ['/permits', loadPermitsPage],
  ['/vehicles/fines-report', loadVehicleFinesReportPage],
  ['/vehicles/accidents', loadVehicleAccidentsPage],
  ['/vehicles/maintenance', loadVehicleMaintenancePage],
  ['/vehicles/', loadVehicleDetailPage],
  ['/vehicles', loadVehiclesHubPage],
  ['/ledger', loadLedgerPage],
  ['/settings', loadSettingsPage],
  ['/expiry', loadExpiryPage],
  ['/duty-locations', loadDutyLocationsPage],
  ['/intake', loadIntakePage],
  ['/scan-inbox', loadScanInboxPage],
  ['/access-requests', loadAccessRequestsPage],
  ['/messages/broadcast', loadSendToGroupPage],
]

// Dedup: dynamic import resolves instantly for an already-loaded chunk, so
// this Set only skips the repeated map lookup + promise allocation.
const prefetched = new Set<string>()

export function prefetchRouteForPath(path: string): void {
  if (prefetched.has(path)) return
  for (const [prefix, loader] of ROUTE_LOADERS) {
    // Exact match or segment boundary — '/books' must not swallow '/bookshelf'.
    if (path === prefix || (prefix !== '/' && path.startsWith(prefix))) {
      prefetched.add(path)
      // A failed prefetch (offline, deploy reshuffle) must not surface as an
      // unhandled rejection — the later lazy() import retries on its own.
      void loader().catch(() => {
        prefetched.delete(path)
      })
      return
    }
  }
}
