/**
 * TimesheetEntry — amendment A1's whole deliverable.
 *
 * The time sheet is a subpage under Employees, not an eighth top-nav entry, so
 * this strip IS the way in: if it does not render, or does not go to
 * `/employees/timesheet`, the feature is unreachable and `navItems.ts` has not
 * been changed to compensate.
 *
 * `EmployeeLookupPage.test.tsx` cannot cover this. It renders the page with a
 * `QueryClientProvider` and no `AuthProvider`, and `CapabilityGate` returns its
 * fallback outside the provider tree (`components/shell/CapabilityGate.tsx:127`)
 * — so there the strip is correctly, and silently, absent. Covering it needs
 * both contexts, which is what this file supplies.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

// The gate resolves the capability through this hook; stub it so the test
// controls the answer (components/perms/CapabilityGate.test.tsx:18).
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: vi.fn() }))
// The gate's catalog lookup is `enabled` only in lock mode, but the dialog is a
// heavy import for a strip test.
vi.mock('@/components/perms/PermissionRequestDialog', () => ({
  PermissionRequestDialog: () => null,
}))

import { AuthContext } from '@/lib/authContext'
import type { AuthContextValue } from '@/lib/authContext'
import { useCapabilities } from '@/lib/useCapabilities'

import { TimesheetEntry } from './TimesheetEntry'

const mockCapabilities = vi.mocked(useCapabilities)

const AUTHED: AuthContextValue = {
  user: {
    id: 1,
    email: 'op@example.com',
    employee_id: null,
    name_en: 'Operator',
    name_ar: null,
    position: null,
    department: null,
    photo_url: null,
    role: 'operator',
    status: 'active',
    is_admin: false,
    is_manager: false,
    has_signature: false,
  },
  status: 'authed',
  login: vi.fn(),
  logout: vi.fn(),
  refetch: vi.fn(),
  setUser: vi.fn(),
}

/** Navigating component test: MemoryRouter + QueryClientProvider, plus the auth
 *  context `CapabilityGate` needs to reach its inner gate at all. */
function renderEntry() {
  return render(
    <MemoryRouter initialEntries={['/employees']}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AuthContext.Provider value={AUTHED}>
          <Routes>
            <Route path="/employees" element={<TimesheetEntry />} />
            <Route path="/employees/timesheet" element={<div data-testid="timesheet-stub" />} />
            <Route path="/employees/:id" element={<div data-testid="detail-stub" />} />
          </Routes>
        </AuthContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('TimesheetEntry', () => {
  it('names the chore and goes to /employees/timesheet', async () => {
    mockCapabilities.mockReturnValue({
      capabilities: new Set(['timesheet.view']),
      isLoading: false,
      has: (cap) => cap === 'timesheet.view',
    })
    renderEntry()

    const entry = await screen.findByRole('button', { name: /monthly time sheet/i })
    expect(entry).toHaveTextContent('Monthly time sheet')
    expect(entry).toHaveTextContent('Check the month, then release the two workbooks')

    await userEvent.click(entry)
    // The static segment, not `/employees/:id` with the id "timesheet".
    expect(await screen.findByTestId('timesheet-stub')).toBeInTheDocument()
    expect(screen.queryByTestId('detail-stub')).not.toBeInTheDocument()
  })

  it('renders nothing for an operator without timesheet.view', () => {
    mockCapabilities.mockReturnValue({
      capabilities: new Set(),
      isLoading: false,
      has: () => false,
    })
    renderEntry()

    // Not a disabled link that bounces them — no affordance at all.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/monthly time sheet/i)).not.toBeInTheDocument()
  })
})
