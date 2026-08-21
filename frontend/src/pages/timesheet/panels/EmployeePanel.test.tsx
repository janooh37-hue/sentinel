/**
 * The G-number picker, the two-month extract and the red-block helper
 * (UI spec §16.3, §15 changes 5 and 6).
 *
 * No shared helper exists. The panel links to the employee record (UI spec §9),
 * so the wrapper is `MemoryRouter` + `QueryClientProvider` — the navigating
 * pattern in `pages/employees/EmployeeActivitySection.test.tsx:109-114`, not the
 * provider-only one this file used before the record link existed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { TimesheetRow } from '@/lib/api'

import { EmployeePanel } from './EmployeePanel'

function wrap(ui: React.ReactNode, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  // The panels link to the employee record now (UI spec §9), so the wrapper
  // needs a router — the navigating-page pattern from
  // pages/employees/EmployeeActivitySection.test.tsx:109-114.
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>
  )
}

function renderPanel(ui: React.ReactNode) {
  return render(wrap(ui))
}

// `nationality_en` is what `constants.nationality_en()` returns, so it can only
// be one of the fifteen mapped English labels — U.A.E, Oman, Nepal, Sudan,
// Jordan, Yemen, Comoros, Mauritania, Egypt, Syria, Morocco, Algeria. There is
// no Bangladeshi or Indian employee at JD 908; using those here would model a
// row the backend can never produce.
const rows: TimesheetRow[] = [
  {
    employee_id: 'G7141',
    name_en: 'MD RASEL HOWLADER',
    designation_en: 'Security Guard',
    designation_ar: 'حارس امن',
    nationality_en: 'Oman',
    row_no: 19,
    codes: [...Array<string>(17).fill('P'), ...Array<string>(14).fill('-')],
    stat_codes: [],
    stat_block: 1,
    stat_filler: null,
    rank_order: 15,
    joined_day: null,
    left_day: 17,
    start_confirmed: false,
    notes: {},
  },
  {
    employee_id: 'G7057',
    name_en: 'RAJESH KUMAR SINGH',
    designation_en: 'assistant security supervisor',
    designation_ar: 'مساعد مشرف',
    nationality_en: 'U.A.E',
    row_no: 7,
    codes: Array<string>(31).fill('P'),
    stat_codes: [],
    stat_block: 1,
    stat_filler: null,
    rank_order: 8,
    joined_day: null,
    left_day: null,
    start_confirmed: false,
    notes: {},
  },
]

const props = {
  rows,
  year: 2026,
  month: 7,
  closed: false,
  // Amendment A3: the red block is a cell write, so it is gated on
  // `timesheet.edit`. The extract only reads and is never gated.
  canEdit: true,
  variant: 'attendance' as const,
  selected: null,
  query: '',
  onQuery: vi.fn(),
  onSelect: vi.fn(),
  onEmployeeDownload: vi.fn(),
  onFillRedBlock: vi.fn(),
}

describe('EmployeePanel', () => {
  it('finds an employee by bare G-number digits', async () => {
    renderPanel(<EmployeePanel {...props} query="7141" />)
    expect(await screen.findByRole('option', { name: /MD RASEL HOWLADER/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /RAJESH/ })).not.toBeInTheDocument()
  })

  it('finds the same employee with the G prefix, either case', async () => {
    const { rerender } = renderPanel(<EmployeePanel {...props} query="g7141" />)
    expect(await screen.findByRole('option', { name: /HOWLADER/ })).toBeInTheDocument()
    rerender(wrap(<EmployeePanel {...props} query="G7141" />))
    expect(await screen.findByRole('option', { name: /HOWLADER/ })).toBeInTheDocument()
  })

  it('finds an employee by name', async () => {
    renderPanel(<EmployeePanel {...props} query="rajesh" />)
    expect(await screen.findByRole('option', { name: /RAJESH KUMAR SINGH/ })).toBeInTheDocument()
  })

  it('finds an employee by designation, in either language', async () => {
    const { rerender } = renderPanel(<EmployeePanel {...props} query="supervisor" />)
    expect(await screen.findByRole('option', { name: /RAJESH/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /HOWLADER/ })).not.toBeInTheDocument()
    rerender(wrap(<EmployeePanel {...props} query="مشرف" />))
    expect(await screen.findByRole('option', { name: /RAJESH/ })).toBeInTheDocument()
  })

  it('previews the roster status and the code counts', async () => {
    renderPanel(<EmployeePanel {...props} selected="G7141" />)
    // UI spec §15 fixes this wording as "last worked day 17"; the grid's row
    // badge in Task 8 asserts the same string. One phrasing, not two.
    expect(await screen.findByText(/last worked day 17/i)).toBeInTheDocument()
    expect(screen.getByTestId('preview-count-P')).toHaveTextContent('17')
    expect(screen.getByTestId('preview-count--')).toHaveTextContent('14')
  })

  it('names both months and exports two workbooks', async () => {
    const onEmployeeDownload = vi.fn()
    renderPanel(
      <EmployeePanel {...props} selected="G7141" onEmployeeDownload={onEmployeeDownload} />,
    )
    expect(await screen.findByText(/June and July 2026/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /2 months/i }))
    expect(onEmployeeDownload).toHaveBeenCalledWith({
      employeeId: 'G7141',
      year: 2026,
      month: 7,
      months: 2,
    })
  })

  it('exports the month on screen alone when only one is wanted', async () => {
    const onEmployeeDownload = vi.fn()
    renderPanel(
      <EmployeePanel {...props} selected="G7141" onEmployeeDownload={onEmployeeDownload} />,
    )
    await userEvent.click(await screen.findByRole('button', { name: /1 month\b/i }))
    expect(onEmployeeDownload).toHaveBeenCalledWith({
      employeeId: 'G7141',
      year: 2026,
      month: 7,
      months: 1,
    })
  })

  it('red blocks the days before the billing start and leaves roster edges alone', async () => {
    const onFillRedBlock = vi.fn()
    renderPanel(<EmployeePanel {...props} selected="G7141" onFillRedBlock={onFillRedBlock} />)
    await userEvent.clear(screen.getByLabelText(/bill starts on day/i))
    await userEvent.type(screen.getByLabelText(/bill starts on day/i), '23')
    await userEvent.click(screen.getByRole('button', { name: /red block/i }))
    // days 1..17 are P and get blocked; 18..22 are `-` and must not be touched
    expect(onFillRedBlock).toHaveBeenCalledWith('G7141', [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    ])
  })

  it('clears the billing-day draft when the selected employee changes', async () => {
    const view = renderPanel(<EmployeePanel {...props} selected="G7141" />)
    const field = await screen.findByLabelText(/bill starts on day/i)
    await userEvent.type(field, '23')
    expect(field).toHaveValue(23)

    view.rerender(wrap(<EmployeePanel {...props} selected="G7057" />))
    const nextField = screen.getByLabelText(/bill starts on day/i)
    expect(nextField).toBe(field)
    expect(nextField).toHaveValue(null)
  })

  /**
   * The whole point of the helper: `set_cell` answers 422
   * `TIMESHEET_OFF_ROSTER` for a day outside the roster window, per cell. A
   * joiner's row opens with `NG`, so a naive `1..N-1` would post the refusals
   * one at a time and collect one error per day.
   */
  it('skips a joiner\u2019s leading roster edge instead of letting the server refuse it', async () => {
    const onFillRedBlock = vi.fn()
    const joiner: TimesheetRow = {
      ...rows[0],
      employee_id: 'G7176',
      name_en: 'FAISAL AKRAM JAVED',
      joined_day: 10,
      left_day: null,
      codes: [...Array<string>(9).fill('NG'), ...Array<string>(22).fill('P')],
    }
    renderPanel(
      <EmployeePanel
        {...props}
        rows={[joiner]}
        selected="G7176"
        onFillRedBlock={onFillRedBlock}
      />,
    )
    await userEvent.type(screen.getByLabelText(/bill starts on day/i), '14')
    await userEvent.click(screen.getByRole('button', { name: /red block/i }))
    expect(onFillRedBlock).toHaveBeenCalledWith('G7176', [10, 11, 12, 13])
  })

  it('offers nothing to block when every day before the start is a roster edge', async () => {
    const onFillRedBlock = vi.fn()
    const joiner: TimesheetRow = {
      ...rows[0],
      employee_id: 'G7176',
      joined_day: 10,
      left_day: null,
      codes: [...Array<string>(9).fill('NG'), ...Array<string>(22).fill('P')],
    }
    renderPanel(
      <EmployeePanel
        {...props}
        rows={[joiner]}
        selected="G7176"
        onFillRedBlock={onFillRedBlock}
      />,
    )
    // Every day before 8 is before day 10: the server would refuse each one.
    await userEvent.type(screen.getByLabelText(/bill starts on day/i), '8')
    expect(screen.getByRole('button', { name: /red block/i })).toBeDisabled()
    expect(screen.getByText(/nothing to block/i)).toBeInTheDocument()
  })

  it('withholds the red block from a read-only operator but keeps the extract', async () => {
    renderPanel(<EmployeePanel {...props} canEdit={false} selected="G7141" />)
    expect(await screen.findByRole('button', { name: /2 months/i })).toBeEnabled()
    // Absent, not disabled: a disabled control still answers Enter and Space
    // (UI spec §14).
    expect(screen.queryByRole('button', { name: /red block/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/bill starts on day/i)).not.toBeInTheDocument()
  })

  it('withholds the red block on a closed month', async () => {
    renderPanel(<EmployeePanel {...props} closed selected="G7141" />)
    expect(await screen.findByRole('button', { name: /2 months/i })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /red block/i })).not.toBeInTheDocument()
  })

  it('moves the cursor with the arrows and selects on Enter', async () => {
    const onSelect = vi.fn()
    renderPanel(<EmployeePanel {...props} onSelect={onSelect} />)
    const search = screen.getByRole('searchbox', { name: /find employee/i })
    await userEvent.click(search)
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('G7057')
  })

  it('reports the search back to the page instead of keeping it', async () => {
    const onQuery = vi.fn()
    renderPanel(<EmployeePanel {...props} onQuery={onQuery} />)
    await userEvent.type(screen.getByRole('searchbox', { name: /find employee/i }), '7')
    expect(onQuery).toHaveBeenCalledWith('7')
  })

  /** §16.3 enumerates the new/leaving badge as part of the preview. */
  it('badges the preview with the roster edge', async () => {
    renderPanel(<EmployeePanel {...props} selected="G7141" />)
    const preview = (await screen.findByText(/last worked day 17/i)).closest('div')
      ?.parentElement as HTMLElement
    expect(preview).toHaveTextContent('to 17')
  })

  it('links the preview to the employee record', async () => {
    renderPanel(<EmployeePanel {...props} selected="G7141" />)
    expect(await screen.findByRole('link', { name: 'G7141' })).toHaveAttribute(
      'href',
      '/employees/G7141',
    )
  })

  it('says so when nothing matches', async () => {
    renderPanel(<EmployeePanel {...props} query="zzzz" />)
    expect(await screen.findByText(/no employee matches that/i)).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })
})
