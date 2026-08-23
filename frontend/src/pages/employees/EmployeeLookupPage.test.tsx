/**
 * EmployeeLookupPage — unit tests (TDD).
 *
 * Three behaviors:
 *   1. Selecting a search result navigates to /employees/:id
 *   2. location.state { openCreate: true } renders the EmployeeForm card
 *   3. localStorage gssg.employees.openId → replace-navigates to profile and clears the key
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const scrollIntoView = vi.fn()

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock the api module so nothing calls the real backend.
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return {
    ...real,
    api: {
      ...real.api,
      getDashboardSummary: vi.fn().mockResolvedValue({
        on_leave_today: [],
        totals: { employees_active: 5 },
      }),
      createEmployee: vi.fn().mockResolvedValue({ id: 'G9999' }),
    },
    apiErrorMessage: vi.fn().mockReturnValue('error'),
  }
})

// Mock EmployeeSearchHero with a simple button so we can trigger onSelect.
vi.mock('@/components/employees/EmployeeSearchHero', () => ({
  EmployeeSearchHero: ({
    onSelect,
    onCreate,
    children,
  }: {
    onSelect: (id: string) => void
    onCreate: () => void
    onLeaveIds: ReadonlySet<string>
    children?: React.ReactNode
  }) => (
    <div data-testid="hero">
      <button type="button" onClick={() => onSelect('G3190')}>
        select-G3190
      </button>
      <button type="button" onClick={onCreate}>
        create
      </button>
      {children}
    </div>
  ),
}))

// The page now reads today's attendance for the hero card and the section tabs;
// both go through useCapabilities -> useAuth, which this suite does not provide.
vi.mock('@/components/employees/useAttendanceAttention', () => ({
  siteToday: () => '2026-08-19',
  useAttendanceAttention: () => ({
    allowed: false,
    isLoading: false,
    attention: null,
    seen: 0,
    late: 0,
    unpaired: 0,
    worst: [],
  }),
}))

vi.mock('@/components/employees/AttendanceHeroCard', () => ({
  AttendanceHeroCard: () => null,
}))

vi.mock('@/components/employees/EmployeesSectionTabs', () => ({
  EmployeesSectionTabs: () => <nav data-testid="employees-section-tabs" />,
}))

// Mock LookupHeroCards to avoid the heavy api calls it makes.
vi.mock('@/components/employees/LookupHeroCards', () => ({
  LookupHeroCards: ({ onOpen }: { onOpen: (id: string) => void }) => (
    <div data-testid="hero-cards">
      <button type="button" onClick={() => onOpen('G0001')}>
        open-card
      </button>
    </div>
  ),
}))

// Mock EmployeeForm to keep the test light while preserving its first focus target.
vi.mock('@/components/employees/EmployeeForm', () => ({
  EmployeeForm: ({ mode }: { mode: string }) => (
    <form data-testid="employee-form" data-mode={mode}>
      <label htmlFor="first-create-field">First create field</label>
      <input id="first-create-field" />
    </form>
  ),
}))
vi.mock('@/components/employees/EmployeeActivitySection', () => ({
  EmployeeActivitySection: ({ onOpenProfile }: { onOpenProfile: (employeeId: string) => void }) => (
    <div data-testid="employee-activity">
      <button type="button" onClick={() => onOpenProfile('G3190')}>
        activity-open-G3190
      </button>
    </div>
  ),
}))

// Silence i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

// Silence sonner
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// ─── Import after mocks ───────────────────────────────────────────────────────
import { EmployeeLookupPage } from './EmployeeLookupPage'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeQC(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

/** Wrap the page under test with a MemoryRouter that has:
 *   /employees → EmployeeLookupPage
 *   /employees/:id → stub div
 */
function setup(
  initialPath = '/employees',
  initialState?: Record<string, unknown>,
) {
  const qc = makeQC()
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[{ pathname: initialPath, state: initialState ?? null }]}
      >
        <Routes>
          <Route path="/employees" element={<EmployeeLookupPage />} />
          <Route
            path="/employees/:id"
            element={<div data-testid="profile-stub" />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return utils
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('EmployeeLookupPage', () => {
  beforeEach(() => {
    localStorage.clear()
    scrollIntoView.mockClear()
    Element.prototype.scrollIntoView = scrollIntoView
  })

  it('navigates to the employee profile when a search result is selected', async () => {
    setup()
    // Hero mock has a "select-G3190" button that calls onSelect('G3190')
    await userEvent.click(screen.getByRole('button', { name: 'select-G3190' }))
    await waitFor(() => {
      expect(screen.getByTestId('profile-stub')).toBeInTheDocument()
    })
  })

  it('keeps activity before the create form and scrolls the form into view', async () => {
    setup('/employees', { openCreate: true })
    const form = await screen.findByTestId('employee-form')
    const activity = screen.getByTestId('employee-activity')
    expect(form).toHaveAttribute('data-mode', 'create')
    expect(activity.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' }))
    expect(screen.getByRole('textbox', { name: 'First create field' })).toHaveFocus()
  })


  it('renders LookupHeroCards inside the hero band', () => {
    setup()
    expect(screen.getByTestId('hero-cards')).toBeInTheDocument()
  })
  it('renders full-width activity below the hero and opens profiles explicitly', async () => {
    setup()
    expect(screen.getByTestId('employee-activity')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'activity-open-G3190' }))
    expect(await screen.findByTestId('profile-stub')).toBeInTheDocument()
  })
})
