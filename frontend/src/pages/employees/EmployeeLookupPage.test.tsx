import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter, parsePath, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { api, type DashboardSummary, type EmployeeActivityItemRead, type EmployeeListItem } from '@/lib/api'
import { getRecentEmployees, recordRecentEmployee } from '@/lib/employeeRecents'
import { toast } from '@/lib/toast'
import en from '@/locales/en.json'
import { EmployeeLookupPage } from './EmployeeLookupPage'

const scrollIntoView = vi.fn()
const dashboardSummary = vi.hoisted(() => ({
  totals: {
    employees_active: 5,
    our_staff: 5,
    loaned: 0,
    on_leave_today: null,
    present_today: null,
    forms_this_month: 0,
    open_violations_count: null,
    book_draft_count: 0,
  },
  on_leave_today: [],
  upcoming_leave_ends: [],
  my_records: null,
  unread_mail: null,
  open_violations: null,
  email_sync: { enabled: false, last_synced_at: null, interval_minutes: 0, incoming_today: 0 },
} satisfies DashboardSummary))

const abdulla: EmployeeListItem = {
  id: 'G3190',
  former_ids: ['G-Old'],
  name_en: 'ABDULLA ALABRI',
  name_ar: 'عبدالله العبري',
  status: 'Loaned',
  position: 'Officer',
  department: null,
  has_photo: false,
}
const recentEmployee = { ...abdulla, id: 'G2210', name_en: 'Recent employee', former_ids: [] }
const filteredEmployee = { ...abdulla, id: 'G1', name_en: 'Filtered employee', former_ids: [] }
const added: EmployeeActivityItemRead = {
  kind: 'employee_added',
  source_id: 1,
  target_id: 1,
  occurred_at: '2026-11-25T09:00:00Z',
  employee_id: abdulla.id,
  employee_name_en: abdulla.name_en,
  title: abdulla.name_en,
  reference: abdulla.id,
}

const { lookup, activity, sectionTabs } = en.employees
const { workspace } = en.dashboard.widgets

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return {
    ...real,
    api: {
      ...real.api,
      getDashboardSummary: vi.fn().mockResolvedValue(dashboardSummary),
      createEmployee: vi.fn().mockResolvedValue({ id: 'G9999' }),
      listEmployees: vi.fn(),
      listEmployeeActivity: vi.fn(),
      getEmployeesCompleteness: vi.fn(),
      getExpiry: vi.fn(),
    },
    apiErrorMessage: vi.fn().mockReturnValue('error'),
  }
})

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    isLoading: false,
    has: (cap: string) => cap === 'employees.view' || cap === 'expiry.view',
  }),
}))

// Mock EmployeeForm to keep the test light while preserving its first focus target.
vi.mock('@/components/employees/EmployeeForm', () => ({
  EmployeeForm: ({ mode, onCancel }: { mode: string; onCancel: () => void }) => (
    <form data-testid="employee-form" data-mode={mode}>
      <label htmlFor="first-create-field">First create field</label>
      <input id="first-create-field" />
      <button type="button" onClick={onCancel}>cancel-create</button>
    </form>
  ),
}))

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

/** Wrap the page under test with a MemoryRouter that has:
 *   /employees → EmployeeLookupPage
 *   /employees/:id → stub div
 */
function setup(
  initialPath = '/employees',
  initialState?: Record<string, unknown>,
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[{ ...parsePath(initialPath), state: initialState ?? null }]}>
        <LocationProbe />
        <Routes>
          <Route
            path="/employees"
            element={<EmployeeLookupPage />}
          />
          <Route
            path="/employees/:id"
            element={<div data-testid="profile-stub" />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function LocationProbe(): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  return (
    <>
      <output data-testid="location" data-navigation={navigationType}>{location.pathname}{location.search}</output>
      <button type="button" onClick={() => navigate(-1)}>Back</button>
    </>
  )
}

describe('EmployeeLookupPage', () => {
  beforeEach(() => {
    localStorage.clear()
    recordRecentEmployee(recentEmployee)
    vi.clearAllMocks()
    vi.mocked(api.listEmployees).mockImplementation(async ({ q, limit = 30, offset = 0 } = {}) => {
      if (!q) return { items: [filteredEmployee], total: 31, limit, offset }
      const needle = q.toLowerCase()
      const items = [abdulla, recentEmployee].filter((row) =>
        [row.id, row.name_en, ...(row.former_ids ?? [])].some((value) => value.toLowerCase().includes(needle)),
      )
      return { items, total: items.length, limit, offset }
    })
    vi.mocked(api.listEmployeeActivity).mockImplementation(async ({ kind, employee_id } = {}) => {
      const items = (!kind || kind === added.kind) && (!employee_id || employee_id === added.employee_id) ? [added] : []
      return { items, total: items.length, limit: 25, offset: 0 }
    })
    vi.mocked(api.getExpiry).mockResolvedValue([{
      employee_id: 'G3300',
      name_en: 'Expiry employee',
      name_ar: null,
      doc_type: 'passport',
      expiry_date: '2026-12-01',
      days_remaining: 6,
      bucket: 'critical',
    }])
    vi.mocked(api.getEmployeesCompleteness).mockResolvedValue({
      incomplete: 1,
      tracked: 5,
      top_missing: [],
      first_incomplete_id: 'G4400',
    })
    Element.prototype.scrollIntoView = scrollIntoView
  })

  it('opens a search result in the activity view, records it, and restores the directory on Clear', async () => {
    const user = userEvent.setup()
    setup()
    expect(screen.getByText(lookup.recentTitle)).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: sectionTabs.aria })).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox'), 'Abdulla')
    await user.click(await screen.findByRole('option', { name: /ABDULLA ALABRI/ }))

    expect(screen.getByTestId('location').textContent).toBe('/employees?employee=G3190')
    expect(await screen.findByRole('link', { name: activity.openProfile })).toHaveAttribute('href', '/employees/G3190')
    expect(screen.getByText('Officer')).toBeInTheDocument()
    expect(screen.queryByText(lookup.recentTitle)).not.toBeInTheDocument()
    expect(screen.queryByText(lookup.expiryTitle)).not.toBeInTheDocument()
    expect(screen.queryByText(lookup.gapsTitle)).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: sectionTabs.aria })).not.toBeInTheDocument()
    expect(screen.queryByTestId('profile-stub')).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveValue('')
    await waitFor(() => expect(getRecentEmployees()[0]?.id).toBe('G3190'))
    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({ employee_id: 'G3190', limit: 25, offset: 0 }))

    await user.click(screen.getByRole('button', { name: activity.clearEmployee }))
    expect(screen.getByTestId('location').textContent).toBe('/employees')
    expect(screen.getByText(lookup.recentTitle)).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: sectionTabs.aria })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: activity.openProfile })).not.toBeInTheDocument()
    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({ limit: 25, offset: 0 }))
  })

  it('keeps the hero search keyboard-operable when it is the only lookup', async () => {
    const user = userEvent.setup()
    setup()
    const input = screen.getByRole('searchbox')
    await user.type(input, 'Abdulla')
    const result = await screen.findByRole('option', { name: /ABDULLA ALABRI/ })
    await user.keyboard('{ArrowDown}')
    expect(result).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(input).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await user.type(input, 'Abdulla')
    await screen.findByRole('option', { name: /ABDULLA ALABRI/ })
    await user.keyboard('{ArrowDown}{Enter}')
    expect(await screen.findByRole('link', { name: activity.openProfile })).toBeInTheDocument()
    expect(input).toHaveFocus()
  })

  it('opens a Recent employee into activity and Back restores the previous kind', async () => {
    const user = userEvent.setup()
    setup('/employees?kind=leave')
    await user.click(screen.getByRole('button', { name: /Recent employee/ }))
    expect(await screen.findByRole('link', { name: activity.openProfile })).toHaveAttribute('href', '/employees/G2210')
    expect(screen.getByTestId('location').textContent).toBe('/employees?kind=leave&employee=G2210')
    expect(screen.queryByTestId('profile-stub')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('location').textContent).toBe('/employees?kind=leave')
    expect(screen.getByRole('button', { name: activity.leave })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(lookup.recentTitle)).toBeInTheDocument()
  })

  it.each([
    [/Expiry employee/, '/employees/G3300'],
    [lookup.gapsCta, '/employees/G4400'],
  ])('keeps %s opening the profile', async (name, href) => {
    setup()
    await userEvent.click(await screen.findByRole('button', { name }))
    expect(await screen.findByTestId('profile-stub')).toBeInTheDocument()
    expect(screen.getByTestId('location').textContent).toBe(href)
  })

  it('requests the URL kind, shows New employees second, and updates the URL when chips change', async () => {
    const user = userEvent.setup()
    setup('/employees?kind=employee_added')
    const group = screen.getByRole('group', { name: activity.typeLabel })
    const [all, newEmployees] = within(group).getAllByRole('button')
    expect(all).toHaveAccessibleName(activity.all)
    expect(newEmployees).toHaveAccessibleName('New employees')
    expect(newEmployees).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({ kind: 'employee_added', limit: 25, offset: 0 }))

    await user.click(within(group).getByRole('button', { name: activity.document }))
    expect(screen.getByTestId('location').textContent).toBe('/employees?kind=document')
    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({ kind: 'document', limit: 25, offset: 0 }))
    await user.click(all)
    expect(screen.getByTestId('location').textContent).toBe('/employees')
    expect(all).toHaveAttribute('aria-pressed', 'true')
  })

  it.each(['bogus', 'all'])('treats kind=%s as the omitted default', async (kind) => {
    setup(`/employees?kind=${kind}`)
    expect(screen.getByRole('button', { name: activity.all })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/employees'))
    expect(api.listEmployeeActivity).toHaveBeenCalledWith({ limit: 25, offset: 0 })
  })

  it('opens a New employees row in-place and shows that employee’s activity', async () => {
    setup('/employees?kind=employee_added')
    await userEvent.click(await screen.findByRole('link', { name: /Added.*G3190/ }))
    expect(await screen.findByRole('link', { name: activity.openProfile })).toHaveAttribute('href', '/employees/G3190')
    expect(screen.getByTestId('location').textContent).toBe('/employees?employee=G3190')
    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({ employee_id: 'G3190', limit: 25, offset: 0 }))
    expect(screen.queryByTestId('profile-stub')).not.toBeInTheDocument()
  })

  it('replaces a case-insensitive former number with the current employee ID', async () => {
    setup('/employees?employee=g-old&kind=leave')
    expect(await screen.findByRole('link', { name: activity.openProfile })).toHaveAttribute('href', '/employees/G3190')
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/employees?employee=G3190&kind=leave'))
    expect(screen.getByTestId('location')).toHaveAttribute('data-navigation', 'REPLACE')
    expect(api.listEmployees).toHaveBeenCalledWith({ q: 'g-old', limit: 30, offset: 0 })
    await waitFor(() => expect(getRecentEmployees()[0]?.id).toBe('G3190'))
  })

  it('prefers an exact current number even when a former match appears on the first search page', async () => {
    const partialMatches = Array.from({ length: 29 }, (_, index) => ({ ...recentEmployee, id: `G-Old-${index}` }))
    vi.mocked(api.listEmployees)
      .mockResolvedValueOnce({ items: [abdulla, ...partialMatches], total: 31, limit: 30, offset: 0 })
      .mockResolvedValueOnce({ items: [{ ...recentEmployee, id: 'G-Old' }], total: 31, limit: 30, offset: 30 })
    setup('/employees?employee=g-old')
    expect(await screen.findByRole('link', { name: activity.openProfile })).toHaveAttribute('href', '/employees/G-Old')
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/employees?employee=G-Old'))
  })

  it('shows a notice and falls back to all activity when only a partial ID matches', async () => {
    setup('/employees?employee=G31&kind=leave&status=Active')
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/employees'))
    expect(toast.info).toHaveBeenCalledWith(activity.employeeNotFound)
    expect(screen.getByText(lookup.recentTitle)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: activity.openProfile })).not.toBeInTheDocument()
    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({ limit: 25, offset: 0 }))
  })

  it('keeps the hero collapsed and holds the feed while a deep link resolves', async () => {
    vi.mocked(api.listEmployees).mockReturnValueOnce(new Promise(() => {}))
    setup('/employees?employee=G3190')
    expect(screen.getByText(en.common.loading)).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
    expect(screen.queryByText(lookup.recentTitle)).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: sectionTabs.aria })).not.toBeInTheDocument()
    await waitFor(() => expect(api.listEmployees).toHaveBeenCalledOnce())
    expect(api.listEmployeeActivity).not.toHaveBeenCalled()
  })

  it('clears roster filters and pagination when selecting an employee from search', async () => {
    const user = userEvent.setup()
    setup('/employees?status=Loaned&pending=1&violations=open&open_violations=true&working=true&present=true&on_leave=true&page=2&kind=leave')
    expect(await screen.findByRole('link', { name: /Filtered employee/ })).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox'), 'Abdulla')
    await user.click(await screen.findByRole('option', { name: /ABDULLA ALABRI/ }))
    expect(screen.getByTestId('location').textContent).toBe('/employees?kind=leave&employee=G3190')
    expect(await screen.findByRole('link', { name: activity.openProfile })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Filtered employee/ })).not.toBeInTheDocument()
    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({ employee_id: 'G3190', kind: 'leave', limit: 25, offset: 0 }))
  })

  it('opens from ?create=1 and cancelling removes create from the URL', async () => {
    setup('/employees?create=1')
    expect(await screen.findByTestId('employee-form')).toHaveAttribute('data-mode', 'create')
    await userEvent.click(screen.getByRole('button', { name: 'cancel-create' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/employees'))
    expect(screen.queryByTestId('employee-form')).not.toBeInTheDocument()
  })

  it('keeps profile navigation from filtered roster results', async () => {
    setup('/employees?violations=open')
    await userEvent.click(await screen.findByRole('link', { name: /Filtered employee/ }))
    expect(await screen.findByTestId('profile-stub')).toBeInTheDocument()
    expect(screen.getByTestId('location').textContent).toBe('/employees/G1?tab=violations')
  })
  it.each([
    ['status=Active', { status: 'Active' }],
    ['status=Loaned', { status: 'Loaned' }],
    ['pending=1', { pending: true }],
    ['violations=open', { open_violations: true }],
    ['working=true', { working: true }],
    ['present=true', { present: true }],
    ['on_leave=true', { on_leave: true }],
  ])('reads %s into a real filtered and paginated employee list', async (search, expected) => {
    setup(`/employees?${search}`)
    expect(await screen.findByRole('link', { name: /Filtered employee/ })).toBeInTheDocument()
    expect(api.listEmployees).toHaveBeenCalledWith(expect.objectContaining({ ...expected, limit: 30, offset: 0 }))
    expect(screen.queryByRole('heading', { name: activity.title })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: workspace.next }))
    await waitFor(() => expect(api.listEmployees).toHaveBeenLastCalledWith(expect.objectContaining({ ...expected, offset: 30 })))
    await userEvent.click(screen.getByRole('link', { name: workspace.clearFilters }))
    expect(await screen.findByRole('heading', { name: activity.title })).toBeInTheDocument()
  })
})
