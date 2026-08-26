/**
 * Dynamic-import loader functions for every code-split page. App.tsx passes
 * these to `lazy()`, and prefetchRoute.ts calls the same functions on nav
 * intent — Vite caches the module fetch, so the later `lazy()` render is
 * instant.
 */

export const loadApplicationPage = () =>
  import('@/pages/application/ApplicationPage').then((m) => ({ default: m.ApplicationPage }))
export const loadBooksPage = () =>
  import('@/pages/books/BooksPage').then((m) => ({ default: m.BooksPage }))
export const loadApprovalsPage = () =>
  import('@/pages/books/ApprovalsPage').then((m) => ({ default: m.ApprovalsPage }))
export const loadBookRecordPage = () =>
  import('@/pages/books/BookRecordPage').then((m) => ({ default: m.BookRecordPage }))
export const loadLeavesPage = () =>
  import('@/pages/leaves/LeavesPage').then((m) => ({ default: m.LeavesPage }))
export const loadPermitsPage = () =>
  import('@/pages/permits/PermitsPage').then((m) => ({ default: m.PermitsPage }))
export const loadLedgerPage = () =>
  import('@/pages/ledger/LedgerPage').then((m) => ({ default: m.LedgerPage }))
export const loadSettingsPage = () =>
  import('@/pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage }))
export const loadDashboardPage = () =>
  import('@/pages/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage }))
export const loadAttendancePage = () =>
  import('@/pages/employees/attendance/AttendancePage').then((m) => ({
    default: m.AttendancePage,
  }))
export const loadEmployeesOrgTreePage = () =>
  import('@/pages/employees/orgTree/EmployeesOrgTreePage').then((m) => ({
    default: m.EmployeesOrgTreePage,
  }))
export const loadEmployeeDetailPage = () =>
  import('@/pages/employees/EmployeeDetailPage').then((m) => ({ default: m.EmployeeDetailPage }))
export const loadTimesheetPage = () =>
  import('@/pages/timesheet/TimesheetPage').then((m) => ({ default: m.TimesheetPage }))
export const loadAccessRequestsPage = () =>
  import('@/pages/access/AccessRequestsPage').then((m) => ({ default: m.AccessRequestsPage }))
export const loadExpiryPage = () =>
  import('@/pages/expiry/ExpiryPage').then((m) => ({ default: m.ExpiryPage }))
export const loadIntakePage = () =>
  import('@/pages/intake/IntakePage').then((m) => ({ default: m.IntakePage }))
export const loadDutyLocationsPage = () =>
  import('@/pages/dutyLocations/DutyLocationsPage').then((m) => ({
    default: m.DutyLocationsPage,
  }))
export const loadScanInboxPage = () =>
  import('@/pages/scanInbox/ScanInboxPage').then((m) => ({ default: m.ScanInboxPage }))
export const loadSendToGroupPage = () =>
  import('@/pages/announcements/SendToGroupPage').then((m) => ({ default: m.SendToGroupPage }))
export const loadScanBackPage = () =>
  import('@/pages/scanBack/ScanBackPage').then((m) => ({ default: m.ScanBackPage }))
