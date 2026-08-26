/**
 * AbsencesPage — the formless absence service behind the Services tile.
 *
 * Behaviours pinned here:
 *   1. No employee picked → the range form stays hidden.
 *   2. Save posts one range payload (ISO dates, trimmed note, null when blank)
 *      and the register lists the episodes afterwards.
 *   3. A partially off-roster range is announced with the skipped count.
 *   4. The register groups contiguous days into episode rows stamped with the
 *      employee's name and post/unit.
 *   5. Copy table puts an HTML register (blue header) + TSV twin on the
 *      clipboard.
 *   6. Removing a row asks for confirmation, then DELETEs the day range.
 *   7. Without leaves.edit there is no Save, no Copy, no remove affordance.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listEmployeeAbsenceEpisodes,
  createEmployeeAbsences,
  deleteEmployeeAbsenceRange,
  copyTable,
  hasCapability,
  toastSuccess,
  toastWarning,
  toastInfo,
  toastError,
} = vi.hoisted(() => ({
  listEmployeeAbsenceEpisodes: vi.fn(),
  createEmployeeAbsences: vi.fn(),
  deleteEmployeeAbsenceRange: vi.fn(),
  copyTable: vi.fn(),
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
    api: {
      ...real.api,
      listEmployeeAbsenceEpisodes,
      createEmployeeAbsences,
      deleteEmployeeAbsenceRange,
    },
  }
})

vi.mock('@/lib/copyTable', () => ({ copyTable }))

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

const RECORD = {
  employee_id: 'G1001',
  employee_name_en: 'John Doe',
  employee_name_ar: 'جون دو',
  duty_post: 'Guard',
  duty_unit: 'Gate 3',
  episodes: [
    { start_date: '2026-07-09', end_date: '2026-07-10', days: 2, notes: 'no call' },
    { start_date: '2026-07-12', end_date: '2026-07-12', days: 1, notes: null },
  ],
}

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
  listEmployeeAbsenceEpisodes.mockResolvedValue({
    ...RECORD,
    episodes: [],
  })
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

  it('saves the picked range and lists the episode register', async () => {
    listEmployeeAbsenceEpisodes.mockResolvedValue(RECORD)
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
    // The register: one row per contiguous run, stamped with who and where.
    expect(await screen.findAllByText('John Doe')).toHaveLength(2)
    expect(screen.getAllByText('Guard / Gate 3')).toHaveLength(2)
    expect(screen.getAllByText('Jul 9, 2026')).toHaveLength(1)
    // The one-day run shows Jul 12 twice: start and end of the same row.
    expect(screen.getAllByText('Jul 12, 2026')).toHaveLength(2)
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

  it('copies the register as HTML with a blue header plus a TSV twin', async () => {
    listEmployeeAbsenceEpisodes.mockResolvedValue(RECORD)
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByTestId('pick-employee'))
    await user.click(await screen.findByRole('button', { name: 'Copy table' }))

    const { html, text } = copyTable.mock.calls[0][0] as { html: string; text: string }
    expect(html).toContain('<table')
    expect(html).toContain('background:#1d4ed8')
    expect(html).toContain('John Doe')
    expect(text.split('\n')[0]).toBe(
      '#\tID\tName\tStart date\tEnd date\tTotal days\tPost unit\tNotes',
    )
    expect(text.split('\n')[1]).toBe(
      '1\tG1001\tJohn Doe\tJul 9, 2026\tJul 10, 2026\t2\tGuard / Gate 3\tno call',
    )
    expect(toastSuccess).toHaveBeenCalledWith('Table copied to the clipboard.')
  })

  it('asks before removing an episode, then deletes its day range', async () => {
    listEmployeeAbsenceEpisodes.mockResolvedValue(RECORD)
    deleteEmployeeAbsenceRange.mockResolvedValue(undefined)
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByTestId('pick-employee'))
    // Two episode rows → two trash buttons; remove the first run. The row's
    // trash button and the dialog's confirm share the "Delete" name.
    const trash = await screen.findAllByRole('button', { name: 'Delete' })
    await user.click(trash[0])
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByText(/Remove the absence from Jul 9, 2026 to Jul 10, 2026/),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(deleteEmployeeAbsenceRange).toHaveBeenCalledWith('G1001', '2026-07-09', '2026-07-10'),
    )
  })

  it('offers no write affordances without leaves.edit', async () => {
    hasCapability.mockImplementation((cap) => cap !== 'leaves.edit')
    listEmployeeAbsenceEpisodes.mockResolvedValue(RECORD)
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByTestId('pick-employee'))

    expect(screen.getByRole('button', { name: 'Record absence' })).toBeDisabled()
    expect(await screen.findAllByText('John Doe')).toHaveLength(2)
    // Copy is a read affordance — viewers keep it; only writes disappear.
    expect(screen.getByRole('button', { name: 'Copy table' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })
})
