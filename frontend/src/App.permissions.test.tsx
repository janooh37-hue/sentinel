import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const capabilityState = vi.hoisted(() => ({ allowed: new Set<string>() }))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: capabilityState.allowed,
    isLoading: false,
    has: (capability: string) => capabilityState.allowed.has(capability),
  }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    listCapabilities: vi.fn().mockResolvedValue([
      {
        id: 'users.manage',
        domain: 'users',
        label_en: 'Manage users and permissions',
        label_ar: 'إدارة المستخدمين والصلاحيات',
        description_en: 'Manage user accounts and effective permissions.',
        description_ar: 'إدارة حسابات المستخدمين وصلاحياتهم الفعلية.',
        sensitive: true,
        requestable: false,
        default_roles: ['admin'],
      },
    ]),
    postCrashReport: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('@/lib/AuthProvider', () => ({ AuthProvider: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ status: 'authed', user: { id: 999 }, logout: vi.fn() }),
}))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('@/lib/useLockState', () => ({
  DEFAULT_IDLE_LOCK_SECONDS: 1800,
  useLockState: () => ({ locked: false, lock: vi.fn(), unlock: vi.fn() }),
}))
vi.mock('@/hooks/useNotificationStream', () => ({ useNotificationStream: vi.fn() }))
vi.mock('@/hooks/useRefreshHeartbeat', () => ({ useRefreshHeartbeat: vi.fn() }))
vi.mock('@/hooks/useRefreshHotkeys', () => ({ useRefreshHotkeys: vi.fn() }))
vi.mock('@/components/shell/BottomTabBar', () => ({ BottomTabBar: () => null }))
vi.mock('@/components/shell/LockOverlay', () => ({ LockOverlay: () => null }))
vi.mock('@/components/shell/MobileTopBar', () => ({ MobileTopBar: () => null }))
vi.mock('@/components/shell/NavDrawer', () => ({ NavDrawer: () => null }))
vi.mock('@/components/shell/TopNav', () => ({ TopNav: () => null }))
vi.mock('@/components/ui/shortcuts-help', () => ({ ShortcutsHelpDialog: () => null }))
vi.mock('@/pages/employees/EmployeeLookupPage', () => ({ EmployeeLookupPage: () => <div>employees-page</div> }))
vi.mock('@/pages/auth/LoginPage', () => ({ LoginPage: () => null }))
vi.mock('@/pages/system/MigrationWizard', () => ({ MigrationGate: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('./components/refresh/TopProgressBar', () => ({ TopProgressBar: () => null }))
vi.mock('./pages/scanBack/ScanBackDock', () => ({ ScanBackDock: () => null }))
vi.mock('./pages/scanBack/ScanBackGate', () => ({ ScanBackGate: () => null }))
vi.mock('@/lib/keyboardShortcuts', () => ({ KeyboardShortcutsProvider: ({ children }: { children: React.ReactNode }) => children }))

vi.mock('@/lib/routeLoaders', () => ({
  loadAccessRequestsPage: () => Promise.resolve({ default: () => <div>access-page</div> }),
  loadApplicationPage: () => Promise.resolve({ default: () => <div>application-page</div> }),
  loadApprovalsPage: () => Promise.resolve({ default: () => <div>approvals-page</div> }),
  loadAttendancePage: () => Promise.resolve({ default: () => <div>attendance-page</div> }),
  loadBookRecordPage: () => Promise.resolve({ default: () => <div>book-record-page</div> }),
  loadBooksPage: () => Promise.resolve({ default: () => <div>books-page</div> }),
  loadDashboardPage: () => Promise.resolve({ default: () => <div>dashboard-page</div> }),
  loadDutyLocationsPage: () => Promise.resolve({ default: () => <div>duty-page</div> }),
  loadEmployeeDetailPage: () => Promise.resolve({ default: () => <div>employee-detail-page</div> }),
  loadEmployeesOrgTreePage: () => Promise.resolve({ default: () => <div>org-tree-page</div> }),
  loadExpiryPage: () => Promise.resolve({ default: () => <div>expiry-page</div> }),
  loadIntakePage: () => Promise.resolve({ default: () => <div>intake-page</div> }),
  loadLeavesPage: () => Promise.resolve({ default: () => <div>leaves-page</div> }),
  loadLedgerPage: () => Promise.resolve({ default: () => <div>ledger-page</div> }),
  loadPermissionsPage: () => Promise.resolve({ default: () => <div>permissions-page</div> }),
  loadPermitsPage: () => Promise.resolve({ default: () => <div>permits-page</div> }),
  loadVehicleAccidentLetterPage: () => Promise.resolve({ default: () => <div>vehicle-accident-letter-page</div> }),
  loadVehicleAccidentsPage: () => Promise.resolve({ default: () => <div>vehicle-accidents-page</div> }),
  loadVehicleDetailPage: () => Promise.resolve({ default: () => <div>vehicle-detail-page</div> }),
  loadVehicleFinesLetterPage: () => Promise.resolve({ default: () => <div>vehicle-fines-letter-page</div> }),
  loadVehicleFinesReportPage: () => Promise.resolve({ default: () => <div>vehicle-fines-report-page</div> }),
  loadVehicleMaintenancePage: () => Promise.resolve({ default: () => <div>vehicle-maintenance-page</div> }),
  loadVehiclesHubPage: () => Promise.resolve({ default: () => <div>vehicles-hub-page</div> }),
  loadScanBackPage: () => Promise.resolve({ default: () => <div>scanback-page</div> }),
  loadScanInboxPage: () => Promise.resolve({ default: () => <div>scan-inbox-page</div> }),
  loadSendToGroupPage: () => Promise.resolve({ default: () => <div>send-page</div> }),
  loadSettingsPage: () => Promise.resolve({ default: () => <div>settings-page</div> }),
  loadTimesheetPage: () => Promise.resolve({ default: () => <div>timesheet-page</div> }),
}))

import App from './App'

const routes = [
  ['/employees', ['employees.view'], 'employees-page'],
  ['/employees/G-1', ['employees.view'], 'employee-detail-page'],
  ['/application', ['documents.generate', 'books.view'], 'application-page'],
  ['/books', ['books.view'], 'books-page'],
  ['/scan-back', ['books.view', 'books.edit'], 'scanback-page'],
  ['/leaves', ['leaves.view'], 'leaves-page'],
  ['/ledger', ['ledger.view'], 'ledger-page'],
  ['/settings', ['settings.view'], 'settings-page'],
  ['/expiry', ['expiry.view'], 'expiry-page'],
  ['/permissions', ['users.manage'], 'permissions-page'],
  ['/vehicles', ['vehicles.view'], 'vehicles-hub-page'],
  ['/vehicles/fines-report', ['vehicles.view'], 'vehicle-fines-report-page'],
  ['/vehicles/accidents', ['vehicles.view'], 'vehicle-accidents-page'],
  ['/vehicles/accidents/17/letter', ['vehicles.view'], 'vehicle-accident-letter-page'],
  ['/vehicles/maintenance', ['vehicles.view'], 'vehicle-maintenance-page'],
  ['/vehicles/42', ['vehicles.view'], 'vehicle-detail-page'],
  ['/vehicles/42/fines-letter', ['vehicles.view'], 'vehicle-fines-letter-page'],
] as const

const eitherCapabilityRoutes = [
  ['/books/approvals', 'approvals-page'],
] as const

beforeEach(() => {
  capabilityState.allowed = new Set()
})

afterEach(() => {
  cleanup()
  window.history.pushState({}, '', '/')
})

describe('App route capability gates', () => {
  it.each(routes)('denies %s without its required capabilities', async (path) => {
    window.history.pushState({}, '', path)
    render(<App />)

    const denialCopy =
      path === '/permissions'
        ? 'Access to this area is managed by administrators and cannot be requested.'
        : "You don't have access to this page"
    expect(await screen.findByText(denialCopy)).toBeVisible()
  })

  it.each([
    ['/employees', "You don't have access to this page"],
    ['/permissions', 'Access to this area is managed by administrators and cannot be requested.'],
  ] as const)('offers no request action for the %s route denial state', async (path, copy) => {
    window.history.pushState({}, '', path)
    render(<App />)

    expect(await screen.findByText(copy)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
  })

  it.each(routes)('renders %s with all required capabilities', async (path, capabilities, pageText) => {
    capabilityState.allowed = new Set(capabilities)
    window.history.pushState({}, '', path)
    render(<App />)

    expect(await screen.findByText(pageText)).toBeVisible()
  })

  it.each(['documents.generate', 'books.view'])(
    'denies /application when %s is the only granted capability',
    async (capability) => {
      capabilityState.allowed = new Set([capability])
      window.history.pushState({}, '', '/application')
      render(<App />)

      expect(await screen.findByText("You don't have access to this page")).toBeVisible()
      expect(screen.queryByText('application-page')).not.toBeInTheDocument()
    },
  )

  it.each(['books.view', 'books.edit'])(
    'denies /scan-back when %s is the only granted capability',
    async (capability) => {
      capabilityState.allowed = new Set([capability])
      window.history.pushState({}, '', '/scan-back')
      render(<App />)

      expect(await screen.findByText("You don't have access to this page")).toBeVisible()
      expect(screen.queryByText('scanback-page')).not.toBeInTheDocument()
    },
  )

  it.each(eitherCapabilityRoutes)(
    'denies %s without books.view or books.approve',
    async (path) => {
      window.history.pushState({}, '', path)
      render(<App />)

      expect(await screen.findByText("You don't have access to this page")).toBeVisible()
    },
  )

  it.each(eitherCapabilityRoutes.flatMap(([path, pageText]) => [
    [path, 'books.view', pageText],
    [path, 'books.approve', pageText],
  ] as const))('renders %s with %s', async (path, capability, pageText) => {
    capabilityState.allowed = new Set([capability])
    window.history.pushState({}, '', path)
    render(<App />)

    expect(await screen.findByText(pageText)).toBeVisible()
  })

  it('renders an assigned-record route for an authenticated user without book capabilities', async () => {
    window.history.pushState({}, '', '/books/42')
    render(<App />)

    expect(await screen.findByText('book-record-page')).toBeVisible()
    expect(screen.queryByText("You don't have access to this page")).not.toBeInTheDocument()
  })

  it('keeps the global books register denied with books.approve alone', async () => {
    capabilityState.allowed = new Set(['books.approve'])
    window.history.pushState({}, '', '/books')
    render(<App />)

    expect(await screen.findByText("You don't have access to this page")).toBeVisible()
    expect(screen.queryByText('books-page')).not.toBeInTheDocument()
  })
})
