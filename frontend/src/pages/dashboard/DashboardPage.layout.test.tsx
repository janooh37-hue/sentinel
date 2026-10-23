import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import type { DashboardSummary } from '@/lib/api'
import type { WidgetProps } from './widgets/types'
import { DEFAULT_LAYOUT, packLayout } from '@/lib/dashboardLayout'
import { DashboardPage } from './DashboardPage'

const state = vi.hoisted(() => ({
  user: { id: 1 } as { id: number } | null,
  denied: new Set<string>(),
  received: ['approver'],
  mobile: false,
}))
vi.mock('@/lib/api', () => ({ api: {
  getDashboardSummary: vi.fn().mockResolvedValue({
    totals: { employees_active: 0, our_staff: 0, loaned: 0, present_today: 0, on_leave_today: 0, forms_this_month: 0, open_violations_count: 0, book_draft_count: 0 },
    on_leave_today: [], upcoming_leave_ends: [], my_records: null, unread_mail: null, open_violations: null,
    email_sync: { enabled: false, interval_minutes: 0, last_synced_at: null, incoming_today: 0 },
  } satisfies DashboardSummary),
  getDashboardLayout: vi.fn(),
  updateDashboardLayout: vi.fn(),
} }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ status: state.user ? 'authed' : 'anonymous', user: state.user }) }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => !state.denied.has(cap), isLoading: false }) }))
vi.mock('@/lib/useIdentity', () => ({ useIdentity: () => ({ identity: null }) }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => state.mobile }))
vi.mock('@/lib/useApprovalSummary', () => ({ useApprovalSummary: () => ({ data: { available_received_kinds: state.received } }) }))
vi.mock('./widgets/legacyAdapters', () => ({
  LegacyWidget: ({ id, tier, rows }: { id: string; tier: string; rows: number }) => (
    <div data-testid={`body-${id}`} data-tier={tier} data-rows={rows}>{id}</div>
  ),
}))
vi.mock('./widgets/MyDocumentsWidget', () => ({ MyDocumentsWidget: (props: WidgetProps) => <div data-testid="body-pending" data-tier={props.tier} data-rows={props.rows} /> }))
vi.mock('./widgets/WaitingApprovalsWidget', () => ({ WaitingApprovalsWidget: (props: WidgetProps) => <div data-testid="body-waiting_approvals" data-tier={props.tier} data-rows={props.rows} /> }))
vi.mock('./widgets/SentApprovalsWidget', () => ({ SentApprovalsWidget: (props: WidgetProps) => <div data-testid="body-sent_approvals" data-tier={props.tier} data-rows={props.rows} /> }))
vi.mock('./widgets/InboxWidget', () => ({ InboxWidget: (props: WidgetProps) => <div data-testid="body-inbox" data-tier={props.tier} data-rows={props.rows} /> }))
vi.mock('./widgets/MyDraftsWidget', () => ({ MyDraftsWidget: (props: WidgetProps) => <div data-testid="body-drafts" data-tier={props.tier} data-rows={props.rows} /> }))
vi.mock('./widgets/UnreadMailWidget', () => ({ UnreadMailWidget: (props: WidgetProps) => <div data-testid="body-ledger" data-tier={props.tier} data-rows={props.rows} /> }))
vi.mock('./widgets/WorkforceCoverageSheet', () => ({ WorkforceCoverageSheet: () => null }))
vi.mock('@/components/refresh/PullToRefresh', () => ({ PullToRefresh: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/components/refresh/RefreshButton', () => ({ RefreshButton: () => null }))

const mockedApi = vi.mocked(api)
function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return { queryClient, ...render(<QueryClientProvider client={queryClient}><MemoryRouter><DashboardPage onNavigate={vi.fn()} /></MemoryRouter></QueryClientProvider>) }
}
async function customize() {
  const button = await screen.findByRole('button', { name: 'Customize' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
}
function widget(id: string): HTMLElement {
  return screen.getByTestId('widget-grid').querySelector<HTMLElement>(`[data-widget-id="${id}"]`)!
}
function boardIds(): string[] {
  return Array.from(screen.getByTestId('widget-grid').querySelectorAll('[data-widget-id]')).map((node) => node.getAttribute('data-widget-id')!)
}

describe('packed per-user dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.user = { id: 1 }
    state.denied.clear()
    state.received = ['approver']
    state.mobile = false
    mockedApi.getDashboardLayout.mockResolvedValue(null)
    mockedApi.updateDashboardLayout.mockImplementation(async (layout) => layout)
  })
  it.each([false, true])('renders one packed grid with explicit boxes on mobile=%s', async (mobile) => {
    state.mobile = mobile
    renderPage()
    await waitFor(() => expect(mockedApi.getDashboardLayout).toHaveBeenCalledTimes(1))
    const cols = mobile ? 2 : 4
    expect(screen.getByTestId('widget-grid')).toHaveAttribute('data-columns', String(cols))
    const visible = DEFAULT_LAYOUT.widgets.filter((item) => item.visible)
    expect(boardIds()).toEqual(visible.map((item) => item.id))
    for (const box of packLayout(visible, cols).placed) {
      expect(widget(box.id).style.gridColumn).toBe(`${box.c + 1} / span ${box.w}`)
      expect(widget(box.id).style.gridRow).toBe(`${box.r + 1} / span ${box.h}`)
    }
    expect(screen.getByTestId('body-waiting_approvals')).toHaveAttribute('data-tier', 'list')
    expect(screen.getByTestId('body-waiting_approvals')).toHaveAttribute('data-rows', '4')
  })
  it('removes unavailable entries before packing and from the add catalog', async () => {
    state.denied.add('books.view')
    state.denied.add('leaves.view')
    state.received = []
    renderPage()
    await customize()
    expect(boardIds()).toEqual(['ledger', 'workspace', 'expiring_soon'])
    const panel = screen.getByRole('complementary', { name: 'Add widgets' })
    expect(within(panel).queryByText('My documents')).not.toBeInTheDocument()
    expect(within(panel).queryByText('Needs your signature')).not.toBeInTheDocument()
    expect(within(panel).queryByText('On Leave Today')).not.toBeInTheDocument()
    expect(within(panel).getByText('Open Violations')).toBeInTheDocument()
    expect(screen.getByTestId('widget-grid').querySelectorAll('article')).toHaveLength(3)
  })
  it('edits width, size, order and visibility in place, retaining focus after moves', async () => {
    renderPage()
    await customize()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const move = within(widget('pending')).getByRole('button', { name: 'Move My documents earlier' })
    move.focus()
    fireEvent.click(move)
    expect(boardIds()[0]).toBe('pending')
    expect(move).toHaveFocus()
    expect(move).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(within(widget('pending')).getByRole('radio', { name: 'Large' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Wide' }))
    expect(screen.getByTestId('widget-grid')).toHaveAttribute('data-columns', '6')
    fireEvent.click(within(widget('drafts')).getByRole('button', { name: 'Remove My drafts' }))
    expect(boardIds()).not.toContain('drafts')
    fireEvent.click(screen.getByRole('button', { name: 'Add Open Violations' }))
    expect(boardIds().at(-1)).toBe('violations')
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }))
    await waitFor(() => expect(mockedApi.updateDashboardLayout).toHaveBeenCalledTimes(1))
    const saved = mockedApi.updateDashboardLayout.mock.calls[0]![0]
    expect(saved.canvas_width).toBe('wide')
    expect(saved.widgets[0]).toMatchObject({ id: 'pending', size: 'L' })
    expect(saved.widgets.find((item) => item.id === 'drafts')?.visible).toBe(false)
    expect(saved.widgets.at(-1)).toMatchObject({ id: 'violations', visible: true, size: 'S' })
    expect(saved.widgets.every((item) => !('zone' in item))).toBe(true)
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Customize' })).toHaveFocus()
  })
  it('supports native radio keyboard selection and native drag-handle moves', async () => {
    const user = userEvent.setup()
    renderPage()
    await customize()
    const small = within(widget('pending')).getByRole('radio', { name: 'Small' })
    small.focus()
    await user.keyboard(' ')
    expect(small).toBeChecked()
    const dataTransfer = { getData: () => 'drafts', setData: vi.fn(), types: ['text/plain'], effectAllowed: '' }
    fireEvent.dragStart(within(widget('drafts')).getByRole('button', { name: 'Drag My drafts to move it' }), { dataTransfer })
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'drafts')
    fireEvent.dragOver(widget('pending'), { dataTransfer })
    fireEvent.drop(widget('pending'), { dataTransfer })
    expect(boardIds().indexOf('drafts')).toBeLessThan(boardIds().indexOf('pending'))
    expect(within(widget('drafts')).getByRole('button', { name: 'Drag My drafts to move it' })).toHaveFocus()
  })
  it('cancels all draft changes, including tile edits, without writing', async () => {
    renderPage()
    await customize()
    fireEvent.click(screen.getByRole('radio', { name: 'Wide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit tiles' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Hide General Book' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(mockedApi.updateDashboardLayout).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByTestId('widget-grid')).toHaveAttribute('data-columns', '4')
    expect(mockedApi.updateDashboardLayout).not.toHaveBeenCalled()
    await customize()
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }))
    await waitFor(() => expect(mockedApi.updateDashboardLayout).toHaveBeenCalledTimes(1))
    expect(mockedApi.updateDashboardLayout.mock.calls[0]![0].quick_actions).toEqual(DEFAULT_LAYOUT.quick_actions)
  })
  it('resets both the board and width, and leaves failures editable', async () => {
    mockedApi.getDashboardLayout.mockResolvedValue({ ...DEFAULT_LAYOUT, canvas_width: 'wide', widgets: DEFAULT_LAYOUT.widgets.map((item) => ({ ...item, visible: false })) })
    mockedApi.updateDashboardLayout.mockRejectedValue(new Error('Save failed'))
    renderPage()
    await customize()
    expect(boardIds()).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(boardIds()).toEqual(DEFAULT_LAYOUT.widgets.filter((item) => item.visible).map((item) => item.id))
    expect(screen.getByTestId('widget-grid')).toHaveAttribute('data-columns', '4')
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }))
    await waitFor(() => expect(mockedApi.updateDashboardLayout).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save layout' })).toBeEnabled())
    expect(screen.getByRole('complementary')).toBeInTheDocument()
  })
  it('does not carry a private draft or cached layout across user changes', async () => {
    const privateLayout = { ...DEFAULT_LAYOUT, canvas_width: 'wide' as const }
    mockedApi.getDashboardLayout.mockImplementation(async () => state.user?.id === 1 ? privateLayout : null)
    const { queryClient, rerender } = renderPage()
    await customize()
    fireEvent.click(within(widget('pending')).getByRole('button', { name: 'Remove My documents' }))
    state.user = { id: 2 }
    rerender(<QueryClientProvider client={queryClient}><MemoryRouter><DashboardPage onNavigate={vi.fn()} /></MemoryRouter></QueryClientProvider>)
    await waitFor(() => expect(mockedApi.getDashboardLayout).toHaveBeenCalledTimes(2))
    expect(boardIds()).toContain('pending')
    expect(screen.getByTestId('widget-grid')).toHaveAttribute('data-columns', '4')
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(mockedApi.updateDashboardLayout).not.toHaveBeenCalled()
  })
})
