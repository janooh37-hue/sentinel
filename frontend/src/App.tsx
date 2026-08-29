import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Toaster } from 'sonner'

import { BottomTabBar } from '@/components/shell/BottomTabBar'
import { LockOverlay } from '@/components/shell/LockOverlay'
import { MobileTopBar } from '@/components/shell/MobileTopBar'
import { NavDrawer } from '@/components/shell/NavDrawer'
import {
  RequireAnyCapability,
  RequireCapability,
} from '@/components/shell/RequireCapability'
import { TopNav } from '@/components/shell/TopNav'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { ShortcutsHelpDialog } from '@/components/ui/shortcuts-help'
import { EmployeeLookupPage } from '@/pages/employees/EmployeeLookupPage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { MigrationGate } from '@/pages/system/MigrationWizard'
import { KeyboardShortcutsProvider } from '@/lib/keyboardShortcuts'
import { AuthProvider } from '@/lib/AuthProvider'
import { useAuth } from '@/lib/authContext'
import { useIsMobile } from '@/lib/useIsMobile'
import { DEFAULT_IDLE_LOCK_SECONDS, useLockState } from '@/lib/useLockState'
import { type Page, PAGE_PATHS, buildPagePath } from '@/lib/pageNav'
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
  loadPermissionsPage,
  loadIntakePage,
  loadLeavesPage,
  loadLedgerPage,
  loadPermitsPage,
  loadScanBackPage,
  loadScanInboxPage,
  loadSendToGroupPage,
  loadSettingsPage,
  loadTimesheetPage,
} from '@/lib/routeLoaders'
import { useNotificationStream } from '@/hooks/useNotificationStream'
import { TopProgressBar } from './components/refresh/TopProgressBar'
import { useRefreshHeartbeat } from './hooks/useRefreshHeartbeat'
import { useRefreshHotkeys } from './hooks/useRefreshHotkeys'
import { ScanBackDock } from './pages/scanBack/ScanBackDock'
import { ScanBackGate } from './pages/scanBack/ScanBackGate'
import '@/lib/i18n'

// Code-split the HugeRTE-using pages (Application, Ledger) and the larger
// list pages — each carries its own ~30-80 KB of feature code that doesn't
// belong in the initial bundle. The import functions live in routeLoaders.ts
// so nav surfaces can prefetch a chunk on hover/focus before lazy() needs it.
const ApplicationPage = lazy(loadApplicationPage)
const BooksPage = lazy(loadBooksPage)
const ApprovalsPage = lazy(loadApprovalsPage)
const BookRecordPage = lazy(loadBookRecordPage)
const LeavesPage = lazy(loadLeavesPage)
const PermitsPage = lazy(loadPermitsPage)
const LedgerPage = lazy(loadLedgerPage)
const SettingsPage = lazy(loadSettingsPage)
const DashboardPage = lazy(loadDashboardPage)
const AttendancePage = lazy(loadAttendancePage)
const AbsencesPage = lazy(() =>
  import('@/pages/absences/AbsencesPage').then((m) => ({ default: m.AbsencesPage })),
)
const EmployeesOrgTreePage = lazy(loadEmployeesOrgTreePage)
const EmployeeDetailPage = lazy(loadEmployeeDetailPage)
// The monthly time sheet is a subpage of Employees, not a top-nav entry, so it
// is code-split here and routed beside the employee routes below.
const TimesheetPage = lazy(loadTimesheetPage)
const AccessRequestsPage = lazy(loadAccessRequestsPage)
const PermissionsPage = lazy(loadPermissionsPage)
const ExpiryPage = lazy(loadExpiryPage)
const IntakePage = lazy(loadIntakePage)
const DutyLocationsPage = lazy(loadDutyLocationsPage)
const ScanInboxPage = lazy(loadScanInboxPage)
const SendToGroupPage = lazy(loadSendToGroupPage)
const ScanBackPage = lazy(loadScanBackPage)
const APPROVALS_ROUTE_CAPS = ['books.view', 'books.approve'] as const

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,   // return-to-app => silently fresh
      refetchOnReconnect: 'always', // after a gap, age unknown => refetch
      staleTime: 15_000,            // gate focus-refetch storms
      gcTime: 5 * 60_000,
    },
  },
})

function PageSuspenseFallback(): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
    </div>
  )
}

function RefreshShellHost() {
  useRefreshHeartbeat()
  useRefreshHotkeys()
  return null
}

/**
 * Maps the legacy page-id navigation prop onto react-router's `useNavigate`
 * so DashboardPage / LedgerPage keep working without a sweeping rewrite.
 */
function useNavigatePage(): (page: Page, id?: string) => void {
  const navigate = useNavigate()
  return (page, id) => navigate(buildPagePath(page, id))
}

function DashboardRoute(): React.JSX.Element {
  const navigatePage = useNavigatePage()
  return <DashboardPage onNavigate={navigatePage} />
}

function LedgerRoute(): React.JSX.Element {
  const navigatePage = useNavigatePage()
  return <LedgerPage onNavigate={navigatePage} />
}

function Shell(): React.JSX.Element {
  const { t } = useTranslation()
  const { status, logout, user } = useAuth()
  const lockTimeoutMs = (user?.idle_lock_seconds ?? DEFAULT_IDLE_LOCK_SECONDS) * 1000
  const { locked, lock, unlock } = useLockState(status === 'authed', lockTimeoutMs)
  const navigate = useNavigate()
  const location = useLocation()
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Phase 4 LAN — SSE notification stream. Enabled only when the session is
  // resolved so it doesn't open a connection that 401s immediately.
  useNotificationStream(status === 'authed')

  // Web Push deep-link: the service worker postMessages the target path when a
  // notification is clicked; route client-side (React Router) so an already-open
  // app — notably iOS standalone PWAs — navigates to the item instead of doing a
  // blank full reload.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent): void => {
      const data = e.data as { type?: string; url?: string } | null
      if (data?.type === 'notification-navigate' && typeof data.url === 'string') {
        navigate(data.url)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate])

  // Auth gate: resolve the session before showing the app chrome.
  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    )
  }
  if (status === 'anon') {
    return (
      <>
        <LoginPage />
        <Toaster position="bottom-right" richColors closeButton />
      </>
    )
  }

  return (
    <>
      <div className="flex h-screen flex-col bg-background">
        <TopProgressBar />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:inset-inline-start-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        >
          {t('a11y.skipToContent')}
        </a>
        {isMobile ? (
          <>
            <MobileTopBar
              onBurger={() => setDrawerOpen(true)}
              onLock={lock}
              onOpenSettings={() => navigate(PAGE_PATHS.settings)}
              onSignOut={() => void logout()}
            />
            <NavDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
          </>
        ) : (
          <TopNav
            onLock={lock}
            onOpenSettings={() => navigate(PAGE_PATHS.settings)}
            onSignOut={() => void logout()}
          />
        )}
        <div className="flex flex-1 overflow-hidden">
          <Suspense fallback={<PageSuspenseFallback />}>
            {/* Route-keyed entrance: remounting on pathname change replays the
                shared fade-up so every page gets a consistent enter motion
                (reduced-motion guarded in index.css). */}
            <main id="main-content" tabIndex={-1} key={location.pathname} className="anim-fade-up flex flex-1 overflow-hidden pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
            <Routes>
              <Route path="/" element={<DashboardRoute />} />
              <Route
                path="/employees"
                element={
                  <RequireCapability cap="employees.view">
                    <EmployeeLookupPage />
                  </RequireCapability>
                }
              />
              {/* A static segment outranks a dynamic one in React Router's route
                  ranking, so this is not swallowed by `/employees/:id`. */}
              <Route
                path="/employees/timesheet"
                element={
                  <RequireCapability cap="timesheet.view">
                    <TimesheetPage />
                  </RequireCapability>
                }
              />
              {/* Static segment: react-router ranks it above /employees/:id
                  regardless of order, and employee ids are G-numbers anyway. */}
              <Route
                path="/employees/attendance"
                element={
                  <RequireCapability cap="workforce.people.view">
                    <AttendancePage />
                  </RequireCapability>
                }
              />
              <Route
                path="/employees/org-tree"
                element={
                  <RequireCapability cap="employees.view">
                    <EmployeesOrgTreePage />
                  </RequireCapability>
                }
              />
              <Route
                path="/employees/:id"
                element={
                  <RequireCapability cap="employees.view">
                    <EmployeeDetailPage />
                  </RequireCapability>
                }
              />
              <Route
                path="/application"
                element={
                  <RequireCapability cap="documents.generate">
                    <RequireCapability cap="books.view">
                      <ApplicationPage />
                    </RequireCapability>
                  </RequireCapability>
                }
              />
              <Route
                path="/books"
                element={
                  <RequireCapability cap="books.view">
                    <BooksPage />
                  </RequireCapability>
                }
              />
              {/* Static segment outranks /books/:id in react-router's ranking —
                  same pattern as /employees/timesheet. */}
              <Route
                path="/books/approvals"
                element={
                  <RequireAnyCapability caps={APPROVALS_ROUTE_CAPS}>
                    <ApprovalsPage />
                  </RequireAnyCapability>
                }
              />
              {/* Pending approval/reviewer assignment is row authority even
                  without global book caps; the API owns that decision. */}
              <Route path="/books/:id" element={<BookRecordPage />} />
              <Route
                path="/scan-back"
                element={
                  <RequireCapability cap="books.view">
                    <RequireCapability cap="books.edit">
                      <ScanBackPage />
                    </RequireCapability>
                  </RequireCapability>
                }
              />
              <Route
                path="/leaves"
                element={
                  <RequireCapability cap="leaves.view">
                    <LeavesPage />
                  </RequireCapability>
                }
              />
              <Route
                path="/absences"
                element={
                  <RequireCapability cap="leaves.view">
                    <AbsencesPage />
                  </RequireCapability>
                }
              />
              <Route
                path="/permits"
                element={
                  <RequireCapability cap="permits.view">
                    <PermitsPage />
                  </RequireCapability>
                }
              />
              <Route
                path="/ledger"
                element={
                  <RequireCapability cap="ledger.view">
                    <LedgerRoute />
                  </RequireCapability>
                }
              />
              <Route
                path="/settings"
                element={
                  <RequireCapability cap="settings.view">
                    <SettingsPage />
                  </RequireCapability>
                }
              />
              <Route
                path="/expiry"
                element={
                  <RequireCapability cap="expiry.view">
                    <ExpiryPage />
                  </RequireCapability>
                }
              />
              <Route
                path="/duty-locations"
                element={
                  <RequireCapability cap="documents.generate">
                    <DutyLocationsPage />
                  </RequireCapability>
                }
              />
              <Route
                path="/intake"
                element={
                  <RequireCapability cap="documents.scan">
                    <IntakePage />
                  </RequireCapability>
                }
              />
              <Route
                path="/scan-inbox"
                element={
                  <RequireCapability cap="documents.scan">
                    <ScanInboxPage />
                  </RequireCapability>
                }
              />
              <Route
                path="/access-requests"
                element={
                  <RequireCapability cap="users.manage">
                    <AccessRequestsPage />
                  </RequireCapability>
                }
              />
              <Route
                path="/messages/broadcast"
                element={
                  <RequireCapability cap="messages.broadcast">
                    <SendToGroupPage />
                  </RequireCapability>
                }
              />
              <Route
                path="/permissions"
                element={
                  <RequireCapability cap="users.manage">
                    <PermissionsPage />
                  </RequireCapability>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </main>
          </Suspense>
        </div>
        {isMobile && <BottomTabBar />}
      </div>
      <ScanBackDock />
      <ScanBackGate />
      {/* Wrapped so print can hide it: sonner renders an empty <section> in
          normal flow here, and a trailing in-flow box after a named-@page
          element (the permits register) costs a blank sheet. */}
      <div data-print-hide>
        <Toaster position="bottom-right" richColors closeButton />
      </div>
      <ShortcutsHelpDialog />
      {locked && (
        <LockOverlay
          onUnlocked={unlock}
          onSignOut={() => {
            unlock()
            void logout()
          }}
        />
      )}
    </>
  )
}

function App(): React.JSX.Element {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RefreshShellHost />
        <AuthProvider>
          <BrowserRouter>
            <KeyboardShortcutsProvider>
              <MigrationGate>
                <Shell />
              </MigrationGate>
            </KeyboardShortcutsProvider>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

export default App
