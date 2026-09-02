/**
 * AbsencesTab — the record-side register on the employee file.
 *
 * Behaviours pinned here:
 *   1. Episodes come from the episodes query (grouped day runs).
 *   2. Removing an episode confirms, DELETEs its day range, and refreshes.
 *   3. Without leaves.edit the remove affordance is hidden.
 *   4. An employee with no absences gets the empty state.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listEmployeeAbsenceEpisodes, deleteEmployeeAbsenceRange, hasCapability } = vi.hoisted(() => ({
  listEmployeeAbsenceEpisodes: vi.fn(),
  deleteEmployeeAbsenceRange: vi.fn(),
  hasCapability: vi.fn<(cap: string) => boolean>(),
}))

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return {
    ...real,
    api: { ...real.api, listEmployeeAbsenceEpisodes, deleteEmployeeAbsenceRange },
  }
})

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set<string>(), isLoading: false, has: hasCapability }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { AbsencesTab } from './AbsencesTab'

const RECORD = {
  employee_id: 'G1001',
  employee_name_en: 'John Doe',
  employee_name_ar: null,
  duty_post: null,
  duty_unit: null,
  episodes: [
    { start_date: '2026-07-09', end_date: '2026-07-10', days: 2, notes: 'no call' },
    { start_date: '2026-07-12', end_date: '2026-07-12', days: 1, notes: null },
  ],
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = render(
    <QueryClientProvider client={client}>
      <AbsencesTab employeeId="G1001" />
    </QueryClientProvider>,
  )
  return { ...rendered, client }
}

beforeEach(() => {
  vi.clearAllMocks()
  hasCapability.mockReturnValue(true)
  listEmployeeAbsenceEpisodes.mockResolvedValue(RECORD)
})

describe('AbsencesTab', () => {
  it('lists the episode runs with start, end, total, and notes', async () => {
    renderTab()
    expect(await screen.findByText('Jul 9, 2026')).toBeInTheDocument()
    // The one-day run shows Jul 12 twice: start and end of the same row.
    expect(screen.getAllByText('Jul 12, 2026')).toHaveLength(2)
    expect(screen.getByText('no call')).toBeInTheDocument()
    expect(listEmployeeAbsenceEpisodes).toHaveBeenCalledWith('G1001')
  })

  it('confirms and deletes an episode by day range', async () => {
    deleteEmployeeAbsenceRange.mockResolvedValue(undefined)
    const { client } = renderTab()
    client.setQueryData(['absence-register'], { rows: [{ employee_id: 'G1001' }] })
    const user = userEvent.setup()

    await screen.findByText('Jul 9, 2026')
    const rows = screen.getAllByRole('button', { name: 'Delete' })
    await user.click(rows[0])
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Remove the absence from Jul 9, 2026 to Jul 10, 2026/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(deleteEmployeeAbsenceRange).toHaveBeenCalledWith('G1001', '2026-07-09', '2026-07-10'),
    )
    expect(client.getQueryState(['absence-register'])?.isInvalidated).toBe(true)
  })

  it('hides the remove affordance without leaves.edit', async () => {
    hasCapability.mockImplementation((cap) => cap !== 'leaves.edit')
    renderTab()
    expect(await screen.findByText('Jul 9, 2026')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('renders the empty state when nothing is recorded', async () => {
    listEmployeeAbsenceEpisodes.mockResolvedValue({ ...RECORD, episodes: [] })
    renderTab()
    expect(
      await screen.findByText('No absences recorded yet.'),
    ).toBeInTheDocument()
  })
})
