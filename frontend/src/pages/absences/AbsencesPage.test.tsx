/**
 * AbsencesPage — the formless absence service behind the Services tile.
 *
 * Behaviours pinned here:
 *   1. No employee picked → the range form stays hidden.
 *   2. Save posts one range payload (ISO dates, trimmed note, null when blank)
 *      and the recorded days list afterwards.
 *   3. A partially off-roster range is announced with the skipped count.
 *   4. Removing a row asks for confirmation, then DELETEs it.
 *   5. Without leaves.edit there is no Save and no remove affordance.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listEmployeeAbsences,
  createEmployeeAbsences,
  deleteEmployeeAbsence,
  hasCapability,
  toastSuccess,
  toastWarning,
  toastInfo,
  toastError,
} = vi.hoisted(() => ({
  listEmployeeAbsences: vi.fn(),
  createEmployeeAbsences: vi.fn(),
  deleteEmployeeAbsence: vi.fn(),
  hasCapability: vi.fn<(cap: string) => boolean>(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return {
    ...real,
    api: { ...real.api, listEmployeeAbsences, createEmployeeAbsences, deleteEmployeeAbsence },
  }
})

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set<string>(), isLoading: false, has: hasCapability }),
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, warning: toastWarning, info: toastInfo, error: toastError },
}))

// The picker is its own query-driven combobox; here it is a plain button that
// picks the fixture employee.
vi.mock('@/pages/leaves/LeaveEmployeePicker', () => ({
  LeaveEmployeePicker: ({ onSelect }: { onSelect: (id: string | null) => void }) => (
    <button type="button" data-testid="pick-employee" onClick={() => onSelect('G1001')}>
      pick
    </button>
  ),
}))

import { AbsencesPage } from './AbsencesPage'

const ROW = (id: number, date: string, note: string | null = null) => ({
  id,
  employee_id: 'G1001',
  date,
  note,
  created_at: '2026-07-09T08:00:00',
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AbsencesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  hasCapability.mockReturnValue(true)
  listEmployeeAbsences.mockResolvedValue([])
  createEmployeeAbsences.mockResolvedValue({
    created: [ROW(1, '2026-07-09', 'no call'), ROW(2, '2026-07-10', 'no call')],
    skipped_off_roster: [],
  })
})

describe('AbsencesPage', () => {
  it('keeps the form hidden until an employee is picked', () => {
    renderPage()
    expect(screen.queryByLabelText('First day')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record absence' })).not.toBeInTheDocument()
  })

  it('saves the picked range and lists the recorded days', async () => {
    listEmployeeAbsences.mockResolvedValue([ROW(2, '2026-07-10', 'no call')])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByTestId('pick-employee'))
    fireEvent.change(screen.getByLabelText('First day'), { target: { value: '2026-07-09' } })
    fireEvent.change(screen.getByLabelText('Last day'), { target: { value: '2026-07-10' } })
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: '  no call  ' } })
    await user.click(screen.getByRole('button', { name: 'Record absence' }))

    await waitFor(() =>
      expect(createEmployeeAbsences).toHaveBeenCalledWith('G1001', {
        start_date: '2026-07-09',
        end_date: '2026-07-10',
        note: 'no call',
      }),
    )
    expect(toastSuccess).toHaveBeenCalledWith('Recorded 2 absence day(s).')
    expect(await screen.findByText('no call')).toBeInTheDocument()
  })

  it('sends a null note when the field is left blank', async () => {
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByTestId('pick-employee'))
    await user.click(screen.getByRole('button', { name: 'Record absence' }))

    await waitFor(() => expect(createEmployeeAbsences).toHaveBeenCalled())
    expect(createEmployeeAbsences.mock.calls[0][1].note).toBeNull()
  })

  it('announces days skipped as off-roster', async () => {
    createEmployeeAbsences.mockResolvedValue({
      created: [ROW(3, '2026-07-11')],
      skipped_off_roster: ['2026-07-09', '2026-07-10'],
    })
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByTestId('pick-employee'))
    fireEvent.change(screen.getByLabelText('First day'), { target: { value: '2026-07-09' } })
    fireEvent.change(screen.getByLabelText('Last day'), { target: { value: '2026-07-11' } })
    await user.click(screen.getByRole('button', { name: 'Record absence' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(toastSuccess.mock.calls[0][0]).toContain('skipped 2 day(s)')
  })

  it('asks before removing a recorded day, then deletes it', async () => {
    listEmployeeAbsences.mockResolvedValue([ROW(2, '2026-07-10', 'no call')])
    deleteEmployeeAbsence.mockResolvedValue(undefined)
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByTestId('pick-employee'))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(screen.getByText(/Remove the absence on/)).toBeInTheDocument()
    // The row's trash button and the dialog's confirm share the "Delete" name.
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteEmployeeAbsence).toHaveBeenCalledWith('G1001', 2))
  })

  it('offers no write affordances without leaves.edit', async () => {
    hasCapability.mockImplementation((cap) => cap !== 'leaves.edit')
    listEmployeeAbsences.mockResolvedValue([ROW(2, '2026-07-10')])
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByTestId('pick-employee'))

    expect(screen.getByRole('button', { name: 'Record absence' })).toBeDisabled()
    expect(await screen.findByText(/Jul 10, 2026/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })
})
