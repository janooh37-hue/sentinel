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

// Mock EmployeeForm to keep the test light — just render a marker div.
vi.mock('@/components/employees/EmployeeForm', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  EmployeeForm: ({ mode }: { mode: string; [k: string]: any }) => (
    <div data-testid="employee-form" data-mode={mode}>
      employee-form
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
  })

  it('navigates to the employee profile when a search result is selected', async () => {
    setup()
    // Hero mock has a "select-G3190" button that calls onSelect('G3190')
    await userEvent.click(screen.getByRole('button', { name: 'select-G3190' }))
    await waitFor(() => {
      expect(screen.getByTestId('profile-stub')).toBeInTheDocument()
    })
  })

  it('renders the create form when location.state has openCreate: true', async () => {
    setup('/employees', { openCreate: true })
    // The EmployeeForm mock renders a div with data-testid="employee-form"
    await waitFor(() => {
      expect(screen.getByTestId('employee-form')).toBeInTheDocument()
    })
    expect(screen.getByTestId('employee-form').getAttribute('data-mode')).toBe(
      'create',
    )
  })

  it('replace-navigates to the profile and clears localStorage when gssg.employees.openId is set', async () => {
    localStorage.setItem('gssg.employees.openId', 'G3190')
    setup()
    await waitFor(() => {
      expect(screen.getByTestId('profile-stub')).toBeInTheDocument()
    })
    expect(localStorage.getItem('gssg.employees.openId')).toBeNull()
  })

  it('renders LookupHeroCards inside the hero band', () => {
    setup()
    expect(screen.getByTestId('hero-cards')).toBeInTheDocument()
  })
})
