import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const capabilityState = vi.hoisted(() => ({ allowed: new Set<string>(), isLoading: false }))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: capabilityState.allowed,
    isLoading: capabilityState.isLoading,
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
      ...['store.view', 'uniform.view'].map((id) => ({
        id,
        domain: id.split('.')[0],
        label_en: id,
        label_ar: null,
        description_en: '',
        description_ar: null,
        sensitive: false,
        requestable: true,
        default_roles: ['admin'],
      })),
    ]),
    postCrashReport: vi.fn().mockResolvedValue(undefined),
    requestPermission: vi.fn().mockResolvedValue({}),
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

vi.mock('@/pages/books/WordSessionPage', () => ({ WordSessionPage: () => <div>word-session-page</div> }))
vi.mock('@/pages/books/WordTemplateSessionPage', () => ({ WordTemplateSessionPage: () => <div>word-template-session-page</div> }))
vi.mock('@/pages/assets/uniform/UniformPage', () => ({
  UniformPage: () => <div>uniform-page</div>,
}))
vi.mock('@/lib/routeLoaders', () => ({
  loadAccessRequestsPage: () => Promise.resolve({ default: () => <div>access-page</div> }),
  loadApplicationPage: () => Promise.resolve({ default: () => <div>application-page</div> }),
  loadApprovalsPage: () => Promise.resolve({ default: () => <div>approvals-page</div> }),
  loadAttendancePage: () => Promise.resolve({ default: () => <div>attendance-page</div> }),
  loadDebugConsolePage: () => Promise.resolve({ default: () => <div>debug-console-page</div> }),
  loadBookRecordPage: () => Promise.resolve({ default: () => <div>book-record-page</div> }),
  loadBooksPage: () => Promise.resolve({ default: () => <div>books-page</div> }),
  loadDashboardPage: () => Promise.resolve({ default: () => <div>dashboard-page</div> }),
  loadDutyLocationsPage: () => Promise.resolve({ default: () => <div>duty-page</div> }),
  loadEmployeeDetailPage: () => Promise.resolve({ default: () => <div>employee-detail-page</div> }),
  loadEmployeeEditPage: () => Promise.resolve({ default: () => <div>employee-edit-page</div> }),
  loadActivityPrintPage: () => Promise.resolve({ default: () => <div>activity-print-page</div> }),
  loadAttendancePrintPage: () => Promise.resolve({ default: () => <div>attendance-print-page</div> }),
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
  loadVehicleEditPage: () => Promise.resolve({ default: () => <div>vehicle-edit-page</div> }),
  loadVehicleImportPage: () => Promise.resolve({ default: () => <div>vehicle-import-page</div> }),
  loadVehicleFinesLetterPage: () => Promise.resolve({ default: () => <div>vehicle-fines-letter-page</div> }),
  loadVehicleFinesPage: () => Promise.resolve({ default: () => <div>vehicle-fines-page</div> }),
  loadVehicleFinesReportPage: () => Promise.resolve({ default: () => <div>vehicle-fines-report-page</div> }),
  loadVehicleMaintenancePage: () => Promise.resolve({ default: () => <div>vehicle-maintenance-page</div> }),
  loadVehiclesHubPage: () => Promise.resolve({ default: () => <div>vehicles-hub-page</div> }),
  loadStoreDashboardPage: () => Promise.resolve({ default: () => <div>store-dashboard-page</div> }),
  loadStoreItemsPage: () => Promise.resolve({ default: () => <div>store-items-page</div> }),
  loadStoreDeliveriesPage: () => Promise.resolve({ default: () => <div>store-deliveries-page</div> }),
  loadStoreDeliveryScanPage: () => Promise.resolve({ default: () => <div>store-delivery-scan-page</div> }),
  loadStoreCountsPage: () => Promise.resolve({ default: () => <div>store-counts-page</div> }),
  loadStoreCountPage: () => Promise.resolve({ default: () => <div>store-count-page</div> }),
  loadStoreDisposalsPage: () => Promise.resolve({ default: () => <div>store-disposals-page</div> }),
  loadStoreMovementsPage: () => Promise.resolve({ default: () => <div>store-movements-page</div> }),
  loadScanBackPage: () => Promise.resolve({ default: () => <div>scanback-page</div> }),
  loadSignaturePlacementPage: () =>
    Promise.resolve({ default: () => <div>signature-placement-page</div> }),
  loadScanInboxPage: () => Promise.resolve({ default: () => <div>scan-inbox-page</div> }),
  loadSendToGroupPage: () => Promise.resolve({ default: () => <div>send-page</div> }),
  loadSettingsPage: () => Promise.resolve({ default: () => <div>settings-page</div> }),
  loadTimesheetPage: () => Promise.resolve({ default: () => <div>timesheet-page</div> }),
}))

import App from './App'
import { api } from '@/lib/api'

const routes = [
  ['/employees', ['employees.view'], 'employees-page'],
  ['/employees/G-1', ['employees.view'], 'employee-detail-page'],
  ['/employees/G100/edit', ['employees.edit'], 'employee-edit-page'],
  ['/employees/G100/edit', ['employees.change_id'], 'employee-edit-page'],
  ['/services', ['documents.generate', 'books.view'], 'application-page'],
  ['/services/general_book', ['documents.generate', 'books.view'], 'application-page'],
  ['/books', ['books.view'], 'books-page'],
  ['/books/42/word', ['books.edit'], 'word-session-page'],
  ['/books/word-templates/17', ['books.templates'], 'word-template-session-page'],
  ['/scan-back', ['books.view', 'books.edit'], 'scanback-page'],
  ['/leaves', ['leaves.view'], 'leaves-page'],
  ['/ledger', ['ledger.view'], 'ledger-page'],
  ['/ledger', ['books.view'], 'ledger-page'],
  ['/settings', ['settings.view'], 'settings-page'],
  ['/expiry', ['expiry.view'], 'expiry-page'],
  ['/permissions', ['users.manage'], 'permissions-page'],
  ['/vehicles', ['vehicles.view'], 'vehicles-hub-page'],
  ['/vehicles/fines', ['vehicles.view'], 'vehicle-fines-page'],
  ['/vehicles/fines-report', ['vehicles.view'], 'vehicle-fines-report-page'],
  ['/vehicles/accidents', ['vehicles.view'], 'vehicle-accidents-page'],
  ['/vehicles/accidents/17/letter', ['vehicles.view'], 'vehicle-accident-letter-page'],
  ['/vehicles/maintenance', ['vehicles.view'], 'vehicle-maintenance-page'],
  ['/vehicles/42', ['vehicles.view'], 'vehicle-detail-page'],
  ['/vehicles/42/fines-letter', ['vehicles.view'], 'vehicle-fines-letter-page'],
  ['/vehicles/edit', ['vehicles.view', 'vehicles.edit'], 'vehicle-edit-page'],
  ['/vehicles/edit/42', ['vehicles.view', 'vehicles.edit'], 'vehicle-edit-page'],
  ['/vehicles/import', ['vehicles.view', 'vehicles.edit'], 'vehicle-import-page'],
  ['/holdings', ['store.view'], 'store-dashboard-page'],
  ['/holdings/store', ['store.view'], 'store-dashboard-page'],
  ['/holdings/uniform', ['uniform.view'], 'uniform-page'],
  ['/holdings/store/movements', ['store.view'], 'store-movements-page'],
  ['/holdings/store/items', ['store.view'], 'store-items-page'],
  ['/holdings/store/deliveries', ['store.view'], 'store-deliveries-page'],
  ['/holdings/store/deliveries/scan', ['store.view', 'store.edit'], 'store-delivery-scan-page'],
  ['/holdings/store/counts', ['store.view'], 'store-counts-page'],
  ['/holdings/store/counts/new', ['store.view', 'store.edit'], 'store-count-page'],
  ['/holdings/store/counts/7', ['store.view', 'store.edit'], 'store-count-page'],
  ['/holdings/store/disposals', ['store.view'], 'store-disposals-page'],
] as const

function visit(path: string): void {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

beforeEach(() => {
  capabilityState.allowed = new Set()
  capabilityState.isLoading = false
  vi.mocked(api.requestPermission).mockClear()
})

afterEach(() => {
  cleanup()
  visit('/')
})

describe('App route capability gates', () => {
  it('does not create browser-history listeners while rendering in StrictMode', () => {
    const listen = vi.spyOn(window, 'addEventListener')
    render(<React.StrictMode><App /></React.StrictMode>)
    const historyListeners = listen.mock.calls.filter(([event]) => event === 'popstate')
    listen.mockRestore()
    expect(historyListeners).toHaveLength(0)
  })

  it.each(routes)('denies %s without its required capabilities', async (path) => {
    visit(path)
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
    visit(path)
    render(<App />)

    expect(await screen.findByText(copy)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
  })

  it.each(routes)('renders %s with all required capabilities', async (path, capabilities, pageText) => {
    capabilityState.allowed = new Set(capabilities)
    visit(path)
    render(<App />)

    expect(await screen.findByText(pageText)).toBeVisible()
  })

  it.each(['documents.generate', 'books.view'])(
    'denies /services when %s is the only granted capability',
    async (capability) => {
      capabilityState.allowed = new Set([capability])
      visit('/services')
      render(<App />)

      expect(await screen.findByText("You don't have access to this page")).toBeVisible()
      expect(screen.queryByText('application-page')).not.toBeInTheDocument()
    },
  )

  it.each(['books.view', 'books.edit'])(
    'denies /scan-back when %s is the only granted capability',
    async (capability) => {
      capabilityState.allowed = new Set([capability])
      visit('/scan-back')
      render(<App />)

      expect(await screen.findByText("You don't have access to this page")).toBeVisible()
      expect(screen.queryByText('scanback-page')).not.toBeInTheDocument()
    },
  )

  it.each(['vehicles.view', 'vehicles.edit'])(
    'denies /vehicles/edit when %s is the only granted capability',
    async (capability) => {
      capabilityState.allowed = new Set([capability])
      visit('/vehicles/edit')
      render(<App />)

      expect(await screen.findByText("You don't have access to this page")).toBeVisible()
      expect(screen.queryByText('vehicle-edit-page')).not.toBeInTheDocument()
    },
  )

  it.each(['store.view', 'store.edit', 'documents.generate'])(
    'denies delivery scan when %s is the only granted capability',
    async (capability) => {
      capabilityState.allowed = new Set([capability])
      visit('/holdings/store/deliveries/scan')
      render(<App />)

      expect(await screen.findByText("You don't have access to this page")).toBeVisible()
      expect(screen.queryByText('store-delivery-scan-page')).not.toBeInTheDocument()
    },
  )

  it.each(['store.view', 'store.edit'])(
    'denies /assets/store/counts/new when %s is the only granted capability',
    async (capability) => {
      capabilityState.allowed = new Set([capability])
      visit('/holdings/store/counts/new')
      render(<App />)

      expect(await screen.findByText("You don't have access to this page")).toBeVisible()
      expect(screen.queryByText('store-count-page')).not.toBeInTheDocument()
    },
  )

  it('renders /books/approvals for an authenticated user with no capabilities — plain authenticated, not capability-gated', async () => {
    visit('/books/approvals')
    render(<App />)

    expect(await screen.findByText('approvals-page')).toBeVisible()
  })

  it('renders an assigned-record route for an authenticated user without book capabilities', async () => {
    visit('/books/42')
    render(<App />)

    expect(await screen.findByText('book-record-page')).toBeVisible()
    expect(screen.queryByText("You don't have access to this page")).not.toBeInTheDocument()
  })

  it('renders the signature-placement route for an authenticated user without book capabilities', async () => {
    visit('/documents/9/signature-placement')
    render(<App />)

    expect(await screen.findByText('signature-placement-page')).toBeVisible()
    expect(screen.queryByText("You don't have access to this page")).not.toBeInTheDocument()
  })

  it('keeps the global books register denied with books.approve alone', async () => {
    capabilityState.allowed = new Set(['books.approve'])
    visit('/books')
    render(<App />)

    expect(await screen.findByText("You don't have access to this page")).toBeVisible()
    expect(screen.queryByText('books-page')).not.toBeInTheDocument()
  })
})

describe('App Assets landing route', () => {
  it.each([
    { caps: ['uniform.view'], pathname: '/holdings/uniform', page: 'uniform-page' },
    { caps: ['store.view'], pathname: '/holdings/store', page: 'store-dashboard-page' },
    { caps: ['store.view', 'uniform.view'], pathname: '/holdings/store', page: 'store-dashboard-page' },
    { caps: [], pathname: '/holdings/store', page: "You don't have access to this page" },
  ])('chooses the viewable default section for $caps', async ({ caps, pathname, page }) => {
    capabilityState.allowed = new Set(caps)
    visit('/holdings')
    render(<App />)

    expect(await screen.findByText(page)).toBeVisible()
    expect(window.location.pathname).toBe(pathname)
    if (caps.length === 0) {
      expect(screen.queryByText('store-dashboard-page')).not.toBeInTheDocument()
      expect(screen.queryByText('uniform-page')).not.toBeInTheDocument()
    } else {
      expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
    }
  })

  it('waits for capabilities before choosing the Uniform-only destination', async () => {
    capabilityState.isLoading = true
    visit('/holdings')
    render(<App />)

    expect(window.location.pathname).toBe('/holdings')
    capabilityState.allowed = new Set(['uniform.view'])
    capabilityState.isLoading = false
    visit('/holdings')

    expect(await screen.findByText('uniform-page')).toBeVisible()
    expect(window.location.pathname).toBe('/holdings/uniform')
  })

  it.each([
    { caps: ['uniform.view'], pathname: '/holdings/store', page: 'store-dashboard-page' },
    { caps: ['store.view'], pathname: '/holdings/uniform', page: 'uniform-page' },
  ])('keeps the other child protected for $caps', async ({ caps, pathname, page }) => {
    capabilityState.allowed = new Set(caps)
    visit(pathname)
    render(<App />)

    expect(await screen.findByText("You don't have access to this page")).toBeVisible()
    expect(screen.queryByText(page)).not.toBeInTheDocument()
    expect(window.location.pathname).toBe(pathname)
  })

  it('preserves the default Store access request when neither section is viewable', async () => {
    visit('/holdings')
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Request access' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Request' }))

    await waitFor(() => expect(api.requestPermission).toHaveBeenCalledExactlyOnceWith('store.view'))
    expect(window.location.pathname).toBe('/holdings/store')
    expect(screen.queryByText('store-dashboard-page')).not.toBeInTheDocument()
    expect(screen.queryByText('uniform-page')).not.toBeInTheDocument()
  })
})

describe('App legacy links', () => {
  it.each([
    ['/application', '/services', ''],
    [
      '/application?form=Inmate%20Conduct%20Violations&mode=stats&stats_month=2026-08',
      '/services/inmate_conduct_violations',
      '?mode=stats&stats_month=2026-08',
    ],
  ] as const)('sends the delivered link %s to its service URL', async (legacy, pathname, search) => {
    capabilityState.allowed = new Set(['documents.generate', 'books.view'])
    visit(legacy)
    render(<App />)

    expect(await screen.findByText('application-page')).toBeVisible()
    expect(window.location.pathname).toBe(pathname)
    expect(window.location.search).toBe(search)
  })
})

describe('App unknown paths', () => {
  it('shows Not found at the requested URL instead of the dashboard', async () => {
    visit('/nope')
    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: /page not found/i })).toBeVisible()
    expect(screen.queryByText('dashboard-page')).not.toBeInTheDocument()
    expect(window.location.pathname).toBe('/nope')
  })
})
