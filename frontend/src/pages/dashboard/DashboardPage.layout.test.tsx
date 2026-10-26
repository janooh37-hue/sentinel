import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ApiModule from '@/lib/api'
import { api } from '@/lib/api'
import { DEFAULT_LAYOUT } from '@/lib/dashboardLayout'
import { DashboardPage } from './DashboardPage'

const authState = vi.hoisted(() => ({
  user: { id: 1 } as { id: number; department_scoping_enabled?: boolean; department_scope_kind?: string } | null,
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: {
    getDashboardSummary: vi.fn().mockResolvedValue({
      department_scope: { kind: 'organization', departments: [] },
      totals: {
        employees_active: null,
        our_staff: null,
        loaned: null,
        on_leave_today: null,
        present_today: null,
        forms_this_month: 0,
        open_violations_count: null,
        draft_count: 0,
        book_draft_count: 0,
      },
      on_leave_today: [],
      upcoming_leave_ends: [],
      recent_documents: [],
      recent_ledger: [],
      email_sync: {
        last_synced_at: null,
        enabled: false,
        interval_minutes: 0,
        incoming_today: 0,
      },
    }),
    getDashboardLayout: vi.fn(),
    departments: { list: vi.fn().mockResolvedValue([]) },
    updateDashboardLayout: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  },
}))

vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({
    status: authState.user ? 'authed' : 'anonymous',
    user: authState.user,
  }),
}))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: () => true }),
}))

vi.mock('@/lib/useIdentity', () => ({
  useIdentity: () => ({ identity: null }),
}))

vi.mock('@/components/dashboard/CustomizeWidgetsDialog', () => ({
  CustomizeWidgetsDialog: (props: {
    items: typeof DEFAULT_LAYOUT.widgets
    onSave: (items: typeof DEFAULT_LAYOUT.widgets, width: 'compact' | 'wide') => void
  }) => (
    <>
      <span data-testid="first-widget">{props.items[0]?.id}</span>
      <button type="button" onClick={() => props.onSave(props.items, 'wide')}>
        save-widget-layout-{props.items.length}
      </button>
    </>
  ),
}))

vi.mock('@/components/dashboard/WidgetEditDialog', () => ({
  WidgetEditDialog: (props: {
    items: typeof DEFAULT_LAYOUT.quick_actions
    onSave: (items: typeof DEFAULT_LAYOUT.quick_actions) => void
  }) => (
    <button type="button" onClick={() => props.onSave(props.items)}>
      save-quick-layout-{props.items.length}
    </button>
  ),
}))

vi.mock('@/components/dashboard/widgets/EmailSyncStatusWidget', () => ({
  EmailSyncStatusWidget: () => null,
}))
vi.mock('@/pages/dashboard/widgets/BooksAwaitingWidget', () => ({ BooksAwaitingWidget: () => null }))
vi.mock('@/pages/dashboard/widgets/ExpiringSoonWidget', () => ({ ExpiringSoonWidget: () => null }))
vi.mock('@/pages/dashboard/widgets/PendingDeparturesWidget', () => ({ PendingDeparturesWidget: () => null }))
vi.mock('@/pages/dashboard/widgets/WaitingApprovalsCard', () => ({ WaitingApprovalsCard: () => null }))
vi.mock('@/pages/dashboard/widgets/WorkforceCoverageSheet', () => ({ WorkforceCoverageSheet: () => null }))
vi.mock('@/pages/dashboard/widgets/WorkforcePulseWidget', () => ({ WorkforcePulseWidget: () => null }))
vi.mock('@/components/refresh/PullToRefresh', () => ({ PullToRefresh: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/components/refresh/RefreshButton', () => ({ RefreshButton: () => null }))

const mockedApi = vi.mocked(api)

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function renderPage(queryClient = createQueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardPage onNavigate={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('DashboardPage per-user layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.user = { id: 1 }
    vi.mocked(api.departments.list).mockResolvedValue([])
    mockedApi.getDashboardLayout.mockResolvedValue(null)
    mockedApi.updateDashboardLayout.mockImplementation(async (layout) => layout)
    mockedApi.getSettings.mockResolvedValue({} as never)
    mockedApi.updateSettings.mockResolvedValue({} as never)
  })

  it('hides the department scope picker with scoping off and no active departments', async () => {
    authState.user = { id: 1, department_scope_kind: 'organization', department_scoping_enabled: false }
    renderPage()
    await screen.findByRole('button', { name: `save-widget-layout-${DEFAULT_LAYOUT.widgets.length}` })
    expect(screen.queryByText('No departments available.')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Department' })).not.toBeInTheDocument()
  })

  it('shows the organization department filter only when scoping is on and departments are usable', async () => {
    authState.user = { id: 1, department_scope_kind: 'organization', department_scoping_enabled: true }
    vi.mocked(api.departments.list).mockResolvedValue([{ id: 3, name_en: 'Operations', name_ar: 'العمليات', active: true }] as never)
    renderPage()
    expect(await screen.findByRole('combobox', { name: 'Department' })).toBeEnabled()
  })

  it('loads the per-user route, falls back to defaults, and saves the full layout', async () => {
    renderPage()

    const save = await screen.findByRole('button', {
      name: `save-widget-layout-${DEFAULT_LAYOUT.widgets.length}`,
    })
    expect(mockedApi.getDashboardLayout).toHaveBeenCalledTimes(1)

    fireEvent.click(save)

    await waitFor(() => expect(mockedApi.updateDashboardLayout).toHaveBeenCalledTimes(1))
    expect(mockedApi.updateDashboardLayout.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        canvas_width: 'wide',
        widgets: expect.any(Array),
        quick_actions: expect.any(Array),
      }),
    )
    expect(mockedApi.getSettings).not.toHaveBeenCalled()
    expect(mockedApi.updateSettings).not.toHaveBeenCalled()
  })

  it('saves quick actions through the same full-layout API', async () => {
    renderPage()

    const save = await screen.findByRole('button', {
      name: `save-quick-layout-${DEFAULT_LAYOUT.quick_actions.length}`,
    })
    fireEvent.click(save)

    await waitFor(() => expect(mockedApi.updateDashboardLayout).toHaveBeenCalledTimes(1))
    expect(mockedApi.updateDashboardLayout.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        canvas_width: DEFAULT_LAYOUT.canvas_width,
        widgets: expect.any(Array),
        quick_actions: expect.any(Array),
      }),
    )
  })

  it('isolates cached layouts across logout and a different authenticated user', async () => {
    const firstDefaultWidget = DEFAULT_LAYOUT.widgets[0]
    const firstPrivateWidget = DEFAULT_LAYOUT.widgets.at(-1)
    expect(firstDefaultWidget).toBeDefined()
    expect(firstPrivateWidget).toBeDefined()
    expect(firstPrivateWidget?.id).not.toBe(firstDefaultWidget?.id)
    const privateLayout = {
      ...DEFAULT_LAYOUT,
      widgets: [
        { ...firstPrivateWidget!, order: 0 },
        ...DEFAULT_LAYOUT.widgets
          .slice(0, -1)
          .map((widget, index) => ({ ...widget, order: index + 1 })),
      ],
    }
    mockedApi.getDashboardLayout.mockImplementation(async () => {
      if (authState.user?.id === 1) return privateLayout
      if (authState.user?.id === 2) return null
      throw new Error('anonymous dashboard layout request')
    })
    const queryClient = createQueryClient()
    const view = renderPage(queryClient)

    await waitFor(() => {
      expect(screen.getByTestId('first-widget')).toHaveTextContent(firstPrivateWidget!.id)
    })
    expect(mockedApi.getDashboardLayout).toHaveBeenCalledTimes(1)

    authState.user = null
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DashboardPage onNavigate={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('first-widget')).toHaveTextContent(firstDefaultWidget!.id)
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: `save-widget-layout-${DEFAULT_LAYOUT.widgets.length}`,
      }),
    )
    let finishMutationTick!: () => void
    const mutationTick = new Promise<void>((resolve) => {
      finishMutationTick = resolve
    })
    setTimeout(finishMutationTick, 25)
    await mutationTick
    expect(mockedApi.updateDashboardLayout).not.toHaveBeenCalled()
    expect(mockedApi.getDashboardLayout).toHaveBeenCalledTimes(1)

    authState.user = { id: 2 }
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DashboardPage onNavigate={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => {
      expect(mockedApi.getDashboardLayout).toHaveBeenCalledTimes(2)
      expect(screen.getByTestId('first-widget')).toHaveTextContent(firstDefaultWidget!.id)
    })
    expect(screen.getByTestId('first-widget')).not.toHaveTextContent(firstPrivateWidget!.id)

    fireEvent.click(
      screen.getByRole('button', {
        name: `save-widget-layout-${DEFAULT_LAYOUT.widgets.length}`,
      }),
    )
    await waitFor(() => expect(mockedApi.updateDashboardLayout).toHaveBeenCalledTimes(1))
    expect(mockedApi.updateDashboardLayout.mock.calls[0]?.[0].widgets[0]?.id).toBe(
      firstDefaultWidget!.id,
    )
  })
})
