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
  api: { listCapabilities: vi.fn().mockResolvedValue([]) },
}))
vi.mock('@/lib/AuthProvider', () => ({ AuthProvider: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ status: 'authed', user: { id: 999 }, logout: vi.fn() }),
}))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('@/lib/useLockState', () => ({
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
  loadScanBackPage: () => Promise.resolve({ default: () => <div>scanback-page</div> }),
  loadScanInboxPage: () => Promise.resolve({ default: () => <div>scan-inbox-page</div> }),
  loadSendToGroupPage: () => Promise.resolve({ default: () => <div>send-page</div> }),
  loadSettingsPage: () => Promise.resolve({ default: () => <div>settings-page</div> }),
  loadTimesheetPage: () => Promise.resolve({ default: () => <div>timesheet-page</div> }),
}))

import App from './App'

const routes = [
  ['/employees', 'employees.view', 'employees-page'],
  ['/employees/G-1', 'employees.view', 'employee-detail-page'],
  ['/application', 'documents.generate', 'application-page'],
  ['/books', 'books.view', 'books-page'],
  ['/books/approvals', 'books.view', 'approvals-page'],
  ['/books/42', 'books.view', 'book-record-page'],
  ['/leaves', 'leaves.view', 'leaves-page'],
  ['/ledger', 'ledger.view', 'ledger-page'],
  ['/settings', 'settings.view', 'settings-page'],
  ['/expiry', 'expiry.view', 'expiry-page'],
  ['/permissions', 'users.manage', 'permissions-page'],
] as const

beforeEach(() => {
  capabilityState.allowed = new Set()
})

afterEach(() => {
  cleanup()
  window.history.pushState({}, '', '/')
})

describe('App route capability gates', () => {
  it.each(routes)('denies %s without %s', async (path) => {
    window.history.pushState({}, '', path)
    render(<App />)

    expect(await screen.findByText("You don't have access to this page")).toBeVisible()
  })

  it.each(routes)('renders %s with %s', async (path, capability, pageText) => {
    capabilityState.allowed = new Set([capability])
    window.history.pushState({}, '', path)
    render(<App />)

    expect(await screen.findByText(pageText)).toBeVisible()
  })
})
