/**
 * AbsencesPage — the formless absence service behind the Services tile.
 *
 * Behaviours pinned here:
 *   1. The global register loads, searches, and copies without picking an employee.
 *   2. The form posts one ISO date range and announces skipped days.
 *   3. Register rows can be edited, extended through today, or removed with confirmation.
 *   4. Selected rows preview the Arabic absence letter and open Ledger prefilled.
 *   5. View-only users keep read affordances but see no absence write actions.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listAbsenceRegister,
  createEmployeeAbsences,
  updateEmployeeAbsenceEpisode,
  deleteEmployeeAbsenceRange,
  copyTable,
  hasCapability,
  toastSuccess,
  toastWarning,
  toastInfo,
  toastError,
} = vi.hoisted(() => ({
  listAbsenceRegister: vi.fn(),
  createEmployeeAbsences: vi.fn(),
  updateEmployeeAbsenceEpisode: vi.fn(),
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
      listAbsenceRegister,
      createEmployeeAbsences,
      updateEmployeeAbsenceEpisode,
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

const REGISTER = {
  rows: [
    {
      employee_id: 'G1001',
      employee_name_en: 'John Doe',
      employee_name_ar: 'جون دو',
      duty_post: 'Guard',
      duty_unit: 'السرية الثالثة',
      start_date: '2026-07-09',
      end_date: '2026-07-10',
      days: 2,
      notes: 'no call',
    },
    {
      employee_id: 'G1001',
      employee_name_en: 'John Doe',
      employee_name_ar: 'جون دو',
      duty_post: 'Guard',
      duty_unit: 'السرية الثالثة',
      start_date: '2026-07-12',
      end_date: '2026-07-12',
      days: 1,
      notes: null,
    },
  ],
}

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>
        <AbsencesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function LedgerProbe(): React.JSX.Element {
  const location = useLocation()
  return <pre data-testid="ledger-probe">{JSON.stringify(location.state)}</pre>
}

function renderPageWithLedgerProbe() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AbsencesPage />} />
          <Route path="/ledger" element={<LedgerProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  hasCapability.mockReturnValue(true)
  listAbsenceRegister.mockResolvedValue({ rows: [] })
  createEmployeeAbsences.mockResolvedValue({
    created: [ROW(1, '2026-07-09', 'no call'), ROW(2, '2026-07-10', 'no call')],
    skipped_off_roster: [],
    skipped_on_leave: [],
  })
  updateEmployeeAbsenceEpisode.mockResolvedValue({
    created: [
      ROW(1, '2026-07-09', 'late'),
      ROW(2, '2026-07-10', 'late'),
      ROW(3, '2026-07-11', 'late'),
    ],
    skipped_off_roster: [],
    skipped_on_leave: [],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AbsencesPage', () => {
  it('keeps the form hidden until an employee is picked', () => {
    renderPage()
    expect(screen.queryByLabelText('First day')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record absence' })).not.toBeInTheDocument()
  })

  it('renders calibrated Employee Absence artwork in the service header', () => {
    const { container } = renderPage()

    expect(
      container.querySelector(
        'header [data-service-artwork="employee-absence"][data-service-size="gallery"] img',
      ),
    ).toHaveAttribute('src', expect.stringContaining('employee-absence.webp'))
    expect(screen.queryByText('🚫')).not.toBeInTheDocument()
  })

  it('lists every recorded absence without picking an employee', async () => {
    listAbsenceRegister.mockResolvedValue(REGISTER)
    renderPage()

    expect(await screen.findAllByText('John Doe')).toHaveLength(2)
    expect(screen.getAllByText('السرية الثالثة')).toHaveLength(2)
    expect(screen.getAllByText('Jul 9, 2026')).toHaveLength(1)
    expect(screen.getAllByText('Jul 12, 2026')).toHaveLength(2)
    expect(screen.queryByLabelText('First day')).not.toBeInTheDocument()
  })

  it('gives repeated employee episodes distinct checkbox names with ID and dates', async () => {
    listAbsenceRegister.mockResolvedValue(REGISTER)
    renderPage()

    const rowCheckboxes = (await screen.findAllByRole('checkbox')).filter((checkbox) =>
      checkbox.getAttribute('aria-label')?.startsWith('Select John Doe'),
    )
    expect(rowCheckboxes).toHaveLength(2)
    expect(rowCheckboxes[0]).toHaveAccessibleName(
      /Select John Doe.*G1001.*Jul 9, 2026.*Jul 10, 2026/,
    )
    expect(rowCheckboxes[1]).toHaveAccessibleName(
      /Select John Doe.*G1001.*Jul 12, 2026.*Jul 12, 2026/,
    )
    expect(rowCheckboxes[0]).not.toHaveAccessibleName(rowCheckboxes[1].getAttribute('aria-label')!)
  })

  it('filters the register by ID or name', async () => {
    listAbsenceRegister.mockResolvedValue(REGISTER)
    renderPage()
    const user = userEvent.setup()

    await screen.findAllByText('John Doe')
    const search = screen.getByRole('searchbox', { name: 'Search by ID or name' })
    await user.type(search, 'G1001')
    expect(screen.getAllByText('G1001')).toHaveLength(2)

    await user.clear(search)
    await user.type(search, 'John Doe')
    expect(screen.getAllByText('John Doe')).toHaveLength(2)

    await user.clear(search)
    await user.type(search, 'zzz')
    expect(screen.getByText('No absences match the search.')).toBeInTheDocument()
  })

  it('saves the picked absence range', async () => {
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
      skipped_on_leave: [],
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

  it('copies the register in the office table layout', async () => {
    listAbsenceRegister.mockResolvedValue(REGISTER)
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Copy table' }))

    await waitFor(() => expect(copyTable).toHaveBeenCalledTimes(1))
    const { html, text } = copyTable.mock.calls[0][0] as { html: string; text: string }
    expect(html).toContain('<table')
    expect(html).toContain('background:#C00000')
    expect(html).toContain('الثالثة')
    expect(text.split('\n')[0]).toBe(
      '*\tID\tالإسم\tالسرية\tتاريخ التغيب\tالى\tعدد الايام\tالملاحظات',
    )
    expect(text.split('\n')[1]).toBe(
      '1\tG1001\tجون دو\tالثالثة\t09/07/2026\t10/07/2026\t2\tno call',
    )
    expect(toastSuccess).toHaveBeenCalledWith('Table copied to the clipboard.')
  })

  it('extends a row to today with one click', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-15T09:00:00'))
    listAbsenceRegister.mockResolvedValue(REGISTER)
    createEmployeeAbsences.mockResolvedValue({
      created: [ROW(3, '2026-07-11'), ROW(4, '2026-07-15')],
      skipped_off_roster: [],
      skipped_on_leave: [],
    })
    renderPage()
    const user = userEvent.setup()

    const buttons = await screen.findAllByRole('button', {
      name: 'Still absent — extend to today',
    })
    await user.click(buttons[0])

    await waitFor(() =>
      expect(createEmployeeAbsences).toHaveBeenCalledWith('G1001', {
        start_date: '2026-07-11',
        end_date: '2026-07-15',
        note: null,
      }),
    )
    expect(toastSuccess).toHaveBeenCalledWith('Absence extended to today (2 day(s) added).')
  })

  it('disables Still absent when the row already reaches today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-10T09:00:00'))
    listAbsenceRegister.mockResolvedValue(REGISTER)
    renderPage()

    const buttons = await screen.findAllByRole('button', {
      name: 'Still absent — extend to today',
    })
    expect(buttons[0]).toBeDisabled()
  })

  it('edits a row and PUTs the redrawn span', async () => {
    listAbsenceRegister.mockResolvedValue(REGISTER)
    renderPage()
    const user = userEvent.setup()

    const editButtons = await screen.findAllByRole('button', { name: 'Edit absence' })
    await user.click(editButtons[0])
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Last day'), {
      target: { value: '2026-07-11' },
    })
    fireEvent.change(within(dialog).getByLabelText('Note (optional)'), {
      target: { value: 'late' },
    })
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(updateEmployeeAbsenceEpisode).toHaveBeenCalledWith('G1001', {
        start_date: '2026-07-09',
        end_date: '2026-07-10',
        new_start_date: '2026-07-09',
        new_end_date: '2026-07-11',
        note: 'late',
      }),
    )
  })

  it('selects rows, previews the letter, and opens the composer prefilled', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-10T09:00:00'))
    listAbsenceRegister.mockResolvedValue(REGISTER)
    renderPageWithLedgerProbe()
    const user = userEvent.setup()

    const rowCheckboxes = await screen.findAllByRole('checkbox', { name: /Select John Doe/ })
    await user.click(rowCheckboxes[0])
    await user.click(screen.getByRole('button', { name: 'Send by email (1)' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('متغيب عن مقر عمله')
    await user.click(within(dialog).getByRole('button', { name: 'Open in email' }))

    const probe = await screen.findByTestId('ledger-probe')
    expect(probe).toHaveTextContent('"subject":"التغيب عن العمل"')
    expect(probe).toHaveTextContent('"basketKey":"absence"')
    expect(probe.textContent).toMatch(/"bodyHtml":"[^"]+/)
    expect(probe).toHaveTextContent('جون دو')
    expect(probe).toHaveTextContent('09/07/2026')
  })

  it('asks before removing an episode, then deletes its day range', async () => {
    listAbsenceRegister.mockResolvedValue(REGISTER)
    deleteEmployeeAbsenceRange.mockResolvedValue(undefined)
    renderPage()
    const user = userEvent.setup()

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

  it('keeps selection and copy available without ledger.send', async () => {
    hasCapability.mockImplementation((cap) => cap !== 'ledger.send')
    listAbsenceRegister.mockResolvedValue(REGISTER)
    renderPage()
    const user = userEvent.setup()

    const rowCheckboxes = await screen.findAllByRole('checkbox', { name: /Select John Doe/ })
    await user.click(rowCheckboxes[0])

    expect(rowCheckboxes[0]).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Send by email (1)' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy table' }))
    await waitFor(() => expect(copyTable).toHaveBeenCalledTimes(1))
    const copyPayload = copyTable.mock.calls[0][0] as { text: string }
    const copiedText = copyPayload.text
    expect(copiedText.split('\n')).toHaveLength(2)
    expect(copiedText).toContain(
      '1\tG1001\tجون دو\tالثالثة\t09/07/2026\t10/07/2026\t2\tno call',
    )
  })

  it('keeps the email handoff hidden without ledger.view', async () => {
    hasCapability.mockImplementation((cap) => cap !== 'ledger.view')
    listAbsenceRegister.mockResolvedValue(REGISTER)
    renderPage()
    const user = userEvent.setup()

    const rowCheckboxes = await screen.findAllByRole('checkbox', { name: /Select John Doe/ })
    await user.click(rowCheckboxes[0])

    expect(rowCheckboxes[0]).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Send by email (1)' })).not.toBeInTheDocument()
  })

  it('offers no write affordances without leaves.edit', async () => {
    hasCapability.mockImplementation((cap) => cap !== 'leaves.edit')
    listAbsenceRegister.mockResolvedValue(REGISTER)
    renderPage()
    const user = userEvent.setup()

    await screen.findAllByText('John Doe')
    await user.click(screen.getByTestId('pick-employee'))

    expect(screen.getByRole('button', { name: 'Record absence' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Copy table' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit absence' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Still absent — extend to today' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })
})
