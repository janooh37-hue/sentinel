/**
 * AbsencesTab — the record-side list on the employee file.
 *
 * Behaviours pinned here:
 *   1. The aggregate snapshot renders while the full list query is in flight,
 *      and the full list replaces it when it lands.
 *   2. Removing a day confirms, DELETEs, and refreshes the list.
 *   3. Without leaves.edit the remove affordance is hidden.
 *   4. An employee with no absences gets the empty state.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listEmployeeAbsences, deleteEmployeeAbsence, hasCapability } = vi.hoisted(() => ({
  listEmployeeAbsences: vi.fn(),
  deleteEmployeeAbsence: vi.fn(),
  hasCapability: vi.fn<(cap: string) => boolean>(),
}))

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return { ...real, api: { ...real.api, listEmployeeAbsences, deleteEmployeeAbsence } }
})

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set<string>(), isLoading: false, has: hasCapability }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { AbsencesTab } from './AbsencesTab'

const SNAPSHOT = [{ id: 1, date: '2026-07-09', note: 'from snapshot' }]
const FULL = [
  { id: 2, employee_id: 'G1001', date: '2026-07-10', note: 'full list', created_at: '2026-07-10T08:00:00' },
  { id: 1, employee_id: 'G1001', date: '2026-07-09', note: 'from snapshot', created_at: '2026-07-09T08:00:00' },
]

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AbsencesTab employeeId="G1001" absences={SNAPSHOT} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  hasCapability.mockReturnValue(true)
  listEmployeeAbsences.mockResolvedValue(FULL)
})

describe('AbsencesTab', () => {
  it('shows the aggregate snapshot first, then the fetched list', async () => {
    renderTab()
    expect(screen.getByText('from snapshot')).toBeInTheDocument()
    expect(await screen.findByText('full list')).toBeInTheDocument()
    expect(listEmployeeAbsences).toHaveBeenCalledWith('G1001')
  })

  it('confirms and deletes a day', async () => {
    deleteEmployeeAbsence.mockResolvedValue(undefined)
    renderTab()
    const user = userEvent.setup()

    await screen.findByText('full list')
    const rows = screen.getAllByRole('button', { name: 'Delete' })
    await user.click(rows[0])

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Remove the absence on/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteEmployeeAbsence).toHaveBeenCalledWith('G1001', 2))
  })

  it('hides the remove affordance without leaves.edit', async () => {
    hasCapability.mockImplementation((cap) => cap !== 'leaves.edit')
    renderTab()
    expect(await screen.findByText('full list')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('renders the empty state when nothing is recorded', async () => {
    listEmployeeAbsences.mockResolvedValue([])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <AbsencesTab employeeId="G1001" absences={[]} />
      </QueryClientProvider>,
    )
    expect(
      await screen.findByText('No absences recorded for this employee.'),
    ).toBeInTheDocument()
  })
})
