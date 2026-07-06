import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Toaster } from 'sonner'

import { BottomTabBar } from '@/components/shell/BottomTabBar'
import { LockOverlay } from '@/components/shell/LockOverlay'
import { MobileTopBar } from '@/components/shell/MobileTopBar'
import { NavDrawer } from '@/components/shell/NavDrawer'
import { RequireCapability } from '@/components/shell/RequireCapability'
import { TopNav } from '@/components/shell/TopNav'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { ShortcutsHelpDialog } from '@/components/ui/shortcuts-help'
import { EmployeesPage } from '@/pages/employees/EmployeesPage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { MigrationGate } from '@/pages/system/MigrationWizard'
import { KeyboardShortcutsProvider } from '@/lib/keyboardShortcuts'
import { AuthProvider } from '@/lib/AuthProvider'
import { useAuth } from '@/lib/authContext'
import { useIsMobile } from '@/lib/useIsMobile'
import { useLockState } from '@/lib/useLockState'
import { type Page, PAGE_PATHS, buildPagePath } from '@/lib/pageNav'
import { useNotificationStream } from '@/hooks/useNotificationStream'
import '@/lib/i18n'

// Code-split the HugeRTE-using pages (Application, Ledger) and the larger
// list pages — each carries its own ~30-80 KB of feature code that doesn't
// belong in the initial bundle.
const ApplicationPage = lazy(() =>
  import('@/pages/application/ApplicationPage').then((m) => ({ default: m.ApplicationPage })),
)
const BooksPage = lazy(() =>
  import('@/pages/books/BooksPage').then((m) => ({ default: m.BooksPage })),
)
const BookRecordPage = lazy(() =>
  import('@/pages/books/BookRecordPage').then((m) => ({ default: m.BookRecordPage })),
)
const LeavesPage = lazy(() =>
  import('@/pages/leaves/LeavesPage').then((m) => ({ default: m.LeavesPage })),
)
const LedgerPage = lazy(() =>
  import('@/pages/ledger/LedgerPage').then((m) => ({ default: m.LedgerPage })),
)
const SettingsPage = lazy(() =>
  import('@/pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const DashboardPage = lazy(() =>
  import('@/pages/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const EmployeeDetailPage = lazy(() =>
  import('@/pages/employees/EmployeeDetailPage').then((m) => ({ default: m.EmployeeDetailPage })),
)
const AccessRequestsPage = lazy(() =>
  import('@/pages/access/AccessRequestsPage').then((m) => ({ default: m.AccessRequestsPage })),
)
const ExpiryPage = lazy(() =>
  import('@/pages/expiry/ExpiryPage').then((m) => ({ default: m.ExpiryPage })),
)
const IntakePage = lazy(() =>
  import('@/pages/intake/IntakePage').then((m) => ({ default: m.IntakePage })),
)
const DutyLocationsPage = lazy(() =>
  import('@/pages/dutyLocations/DutyLocationsPage').then((m) => ({
    default: m.DutyLocationsPage,
  })),
)
const ScanInboxPage = lazy(() =>
  import('@/pages/scanInbox/ScanInboxPage').then((m) => ({ default: m.ScanInboxPage })),
)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Most list/detail pages don't change every few seconds — bumping the
      // stale window keeps tab switches snappy without losing data freshness.
      // Per-query overrides still apply (e.g. job-status polling uses 0).
      staleTime: 60_000,
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
  const { locked, lock, unlock } = useLockState()
  const { status, logout } = useAuth()
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
            <main id="main-content" tabIndex={-1} key={location.pathname} className="anim-fade-up flex flex-1 overflow-hidden pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
            <Routes>
              <Route path="/" element={<DashboardRoute />} />
              <Route path="/employees" element={<EmployeesPage />} />
              <Route path="/employees/:id" element={<EmployeeDetailPage />} />
              <Route path="/application" element={<ApplicationPage />} />
              <Route path="/books" element={<BooksPage />} />
              <Route path="/books/:id" element={<BookRecordPage />} />
              <Route path="/leaves" element={<LeavesPage />} />
              <Route path="/ledger" element={<LedgerRoute />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/expiry" element={<ExpiryPage />} />
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
              {/* The standalone /permissions page was folded into Active-users
                  (Access requests → three-dots). Redirect old bookmarks/links
                  there instead of silently bouncing to Dashboard. */}
              <Route path="/permissions" element={<Navigate to="/access-requests" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </main>
          </Suspense>
        </div>
        {isMobile && <BottomTabBar />}
      </div>
      <Toaster position="bottom-right" richColors closeButton />
      <ShortcutsHelpDialog />
      {locked && <LockOverlay onUnlocked={unlock} />}
    </>
  )
}

function App(): React.JSX.Element {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
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
