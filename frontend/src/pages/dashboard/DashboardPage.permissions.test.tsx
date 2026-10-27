import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import i18n from 'i18next'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type DashboardSummary } from '@/lib/api'
import { DEFAULT_LAYOUT } from '@/lib/dashboardLayout'
import ar from '@/locales/ar.json'
import { DashboardPage } from './DashboardPage'

const capabilityState = vi.hoisted(() => ({ allowed: new Set<string>() }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    has: (capability: string) => capabilityState.allowed.has(capability),
  }),
}))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1 } }) }))
vi.mock('@/lib/useIdentity', () => ({ useIdentity: () => ({ identity: null }) }))
vi.mock('@/lib/useApprovalSummary', () => ({ useApprovalSummary: () => ({ data: undefined }) }))
vi.mock('@/lib/api', () => ({
  api: { getDashboardSummary: vi.fn(), getDashboardLayout: vi.fn() },
}))
vi.mock('@/components/dashboard/CustomizeWidgetsDialog', () => ({ CustomizeWidgetsDialog: () => null }))
vi.mock('@/components/dashboard/WidgetEditDialog', () => ({ WidgetEditDialog: () => null }))
vi.mock('@/pages/dashboard/widgets/WorkforceCoverageSheet', () => ({ WorkforceCoverageSheet: () => null }))
vi.mock('@/components/refresh/PullToRefresh', () => ({ PullToRefresh: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/components/refresh/RefreshButton', () => ({ RefreshButton: () => null }))

const readerCaps = ['employees.view', 'leaves.view', 'violations.view', 'ledger.view']
const visibleWidgets: Record<string, true> = {
  workspace: true,
  violations: true,
  ledger: true,
  on_leave_today: true,
  upcoming_leave: true,
  recent_ledger: true,
}

function summary(): DashboardSummary {
  return {
    totals: {
      employees_active: 12,
      our_staff: 10,
      loaned: 2,
      on_leave_today: 3,
      present_today: 7,
      forms_this_month: 4,
      open_violations_count: 6,
      draft_count: 1,
      book_draft_count: 1,
    },
    on_leave_today: [{
      leave_id: 1,
      employee_id: 'G-1',
      employee_name_en: 'Aisha Noor',
      employee_name_ar: 'عائشة نور',
      leave_type: 'annual',
      start_date: '2026-10-20',
      end_date: '2026-10-23',
    }],
    upcoming_leave_ends: [{
      leave_id: 1,
      employee_id: 'G-1',
      employee_name_en: 'Aisha Noor',
      employee_name_ar: 'عائشة نور',
      leave_type: 'annual',
      end_date: '2026-10-23',
      days_remaining: 0,
    }],
    recent_documents: [],
    recent_ledger: [],
    email_sync: { enabled: false, last_synced_at: null, interval_minutes: 0, incoming_today: 0 },
  }
}

const DEFAULT_WIDGETS = DEFAULT_LAYOUT.widgets ?? []

function renderPage(data = summary(), widgets = DEFAULT_WIDGETS.map((widget) => ({ ...widget, visible: Boolean(visibleWidgets[widget.id]) }))) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(['dashboard'], data)
  client.setQueryData(['dashboard-layout', 1], {
    ...DEFAULT_LAYOUT,
    widgets,
  })
  vi.mocked(api.getDashboardSummary).mockResolvedValue(data)
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage onNavigate={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(async () => {
  cleanup()
  document.documentElement.removeAttribute('dir')
  await i18n.changeLanguage('en')
})

describe.each([
  { language: 'en', width: 390 },
  { language: 'en', width: 1280 },
  { language: 'ar', width: 390 },
  { language: 'ar', width: 1280 },
])('Dashboard permissions ($language, $width px)', ({ language, width }) => {
  beforeEach(async () => {
    vi.clearAllMocks()
    capabilityState.allowed = new Set(readerCaps)
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage(language)
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  })

  it('preserves all cards for authorized readers', () => {
    renderPage()
    expect(screen.getByRole('button', { name: i18n.t('dashboard.widgets.violations.header') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('dashboard.widgets.ledger.header') })).toBeInTheDocument()
    expect(screen.getByText(i18n.t('dashboard.workspace.title'))).toBeInTheDocument()
    expect(screen.getByRole('region', { name: i18n.t('dashboard.onLeave.title') })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: i18n.t('dashboard.upcoming.title') })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: i18n.t('dashboard.recent.ledger') })).toBeInTheDocument()
  })

  it('hides violations when violations.view is denied', () => {
    capabilityState.allowed.delete('violations.view')
    renderPage()
    expect(screen.queryByRole('button', { name: i18n.t('dashboard.widgets.violations.header') })).not.toBeInTheDocument()
    expect(screen.getByText(i18n.t('dashboard.workspace.title'))).toBeInTheDocument()
  })

  it('hides leave sections and names when leaves.view is denied', () => {
    capabilityState.allowed.delete('leaves.view')
    renderPage()
    expect(screen.queryByRole('region', { name: i18n.t('dashboard.onLeave.title') })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: i18n.t('dashboard.upcoming.title') })).not.toBeInTheDocument()
    expect(screen.queryByText(language === 'ar' ? 'عائشة نور' : 'Aisha Noor')).not.toBeInTheDocument()
  })

  it('hides ledger metric and recent correspondence when ledger.view is denied', () => {
    capabilityState.allowed.delete('ledger.view')
    renderPage()
    expect(screen.queryByRole('button', { name: i18n.t('dashboard.widgets.ledger.header') })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: i18n.t('dashboard.recent.ledger') })).not.toBeInTheDocument()
  })

  it('hides workspace when employees.view is denied', () => {
    capabilityState.allowed.delete('employees.view')
    renderPage()
    expect(screen.queryByText(i18n.t('dashboard.workspace.title'))).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: i18n.t('dashboard.onLeave.title') })).toBeInTheDocument()
  })

  it('renders unavailable leave and on-site counts as em dashes, not zero or all-present claims', () => {
    capabilityState.allowed.delete('leaves.view')
    const data = summary()
    data.totals.on_leave_today = null
    data.totals.present_today = null
    data.on_leave_today = []
    data.upcoming_leave_ends = []
    renderPage(data)
    const workspace = screen.getByText(i18n.t('dashboard.workspace.title')).closest('button')!
    expect(within(workspace).getAllByText('—')).toHaveLength(2)
    expect(within(workspace).queryByText('0')).not.toBeInTheDocument()
    expect(within(workspace).getAllByText(language === 'ar' ? 'غير متاح' : 'Not available')).toHaveLength(2)
    expect(within(workspace).getAllByText('—').every((node) => node.getAttribute('aria-hidden') === 'true')).toBe(true)
  })

  it('lets the sole rendered top card fill the row', () => {
    capabilityState.allowed.delete('employees.view')
    const widgets = DEFAULT_WIDGETS.map((widget) => ({
      ...widget, visible: widget.id === 'workspace' || widget.id === 'pending', zone: 'top' as const,
    }))
    renderPage(summary(), widgets)
    const card = screen.getByRole('button', { name: new RegExp(i18n.t('dashboard.pending.title')) })
    expect(card.parentElement?.parentElement).not.toHaveClass('md:grid-cols-2')
  })

  it('omits zone wrappers when every configured card is denied', () => {
    capabilityState.allowed = new Set()
    const widgets = DEFAULT_WIDGETS.map((widget) => ({
      ...widget,
      visible: ['workspace', 'violations', 'ledger'].includes(widget.id),
      zone: widget.id === 'workspace' ? 'top' as const : widget.id === 'violations' ? 'under_workspace' as const : 'under_quick_actions' as const,
    }))
    const { container } = renderPage(summary(), widgets)
    expect(container.querySelectorAll('.mb-6.grid')).toHaveLength(0)
  })
})
