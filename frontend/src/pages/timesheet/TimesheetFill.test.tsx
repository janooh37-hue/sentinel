/**
 * Drag-to-fill through the real page — the one path where the grid, the shell's
 * handlers and Task 7's cell writer all have to agree.
 *
 * `set_cell` is one cell and it refuses PER cell: an override on a day outside
 * the roster window answers 422 `TIMESHEET_OFF_ROSTER` while its neighbours are
 * taken. So a sweep has to degrade rather than fail — the accepted days stay,
 * each refused day rolls back to its last server-confirmed value, and the
 * operator hears about it once.
 *
 * Its own file, not a thirteenth case in `TimesheetPage.test.tsx`: that file
 * holds the twelve Task 7 settled and its sonner stub carries no `warning`,
 * which the grid's own client-side refusal needs. Splitting keeps both mock
 * surfaces honest instead of widening one to cover two jobs.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('@/lib/api', () => ({
  api: { getTimesheet: vi.fn(), setTimesheetCell: vi.fn() },
  apiErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: vi.fn() }))

import { api } from '@/lib/api'
import type { TimesheetGridResponse, TimesheetRow } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'

import { TimesheetPage } from './TimesheetPage'

/** A joiner: the roster edge owns days 1–4, so the server refuses those. */
const ROW: TimesheetRow = {
  employee_id: 'G1001',
  row_no: 1,
  name_en: 'AHMED BILAL NOOR',
  nationality_en: 'India',
  designation_en: 'SECURITY GUARD',
  designation_ar: 'حارس أمن',
  rank_order: 1,
  codes: Array.from({ length: 31 }, () => 'P'),
  stat_codes: Array.from({ length: 31 }, () => 'P'),
  stat_block: 1,
  stat_filler: null,
  joined_day: null,
  left_day: null,
  start_confirmed: false,
  notes: {},
  edits: {},
}

const MONTH: TimesheetGridResponse = {
  year: 2026,
  month: 7,
  days_in_month: 31,
  sheet: 'main',
  post_count: 249,
  rows: [ROW],
  blocking: [],
  warnings: [],
  removed: [],
  closed_at: null,
  closed_by: null,
}

const getTimesheet = vi.mocked(api.getTimesheet)
const setTimesheetCell = vi.mocked(api.setTimesheetCell)
const mockCapabilities = vi.mocked(useCapabilities)

/**
 * The month the fake server holds, which ACCUMULATES accepted writes.
 *
 * `set_cell` answers with the whole recomputed month, so a stateless mock that
 * rebuilt the response from the pristine row would have each answer silently
 * un-paint the write before it — reporting a product defect that only the mock
 * had.
 */
let month: TimesheetGridResponse = MONTH

const accept = (
  employeeId: string,
  day: number,
  code: string | null,
): TimesheetGridResponse => {
  month = {
    ...month,
    rows: month.rows.map((row) =>
      row.employee_id === employeeId
        ? { ...row, codes: row.codes.map((c, i) => (i === day - 1 ? code : c)) }
        : row,
    ),
  }
  return month
}

function renderPage() {
  return render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <TimesheetPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const cellOf = (day: number): HTMLElement =>
  screen.getByRole('button', { name: new RegExp(`G1001 day ${day} `, 'i') })

beforeEach(() => {
  vi.clearAllMocks()
  month = MONTH
  mockCapabilities.mockReturnValue({
    capabilities: new Set(['timesheet.view', 'timesheet.edit']),
    isLoading: false,
    has: () => true,
  })
  getTimesheet.mockImplementation(() => Promise.resolve(month))
})

describe('drag to fill, through the page', () => {
  it('commits one write per swept cell and confirms the run once', async () => {
    setTimesheetCell.mockImplementation((_p, body) =>
      Promise.resolve(accept(body.employee_id, body.day, body.code)),
    )
    renderPage()
    await screen.findByRole('table')

    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: cellOf(3) },
      { target: cellOf(6) },
      { keys: '[/MouseLeft]' },
    ])

    // Four cells, four writes: `set_cell` takes one cell, and the whole point
    // of committing on pointerup is that it happens once per gesture and not
    // once per pointermove.
    await waitFor(() => expect(setTimesheetCell).toHaveBeenCalledTimes(4))
    expect(setTimesheetCell.mock.calls.map((c) => c[1].day)).toEqual([3, 4, 5, 6])
    // Nothing was armed, so the sweep spread the anchor's own code.
    expect(new Set(setTimesheetCell.mock.calls.map((c) => c[1].code))).toEqual(new Set(['P']))
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    // UI spec §8's range line, which `timesheet.rangePainted` has carried in
    // both locales since the copy landed and nothing rendered. One employee,
    // one contiguous run, so it can name the span instead of counting cells.
    expect(toast.success).toHaveBeenCalledWith('G1001 · day 3–6 — P')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('counts the cells instead of naming a span when the run is not one', async () => {
    // Two rows, so the rectangle is not one employee's run: `G1001 · day 3–4`
    // would name a span that only half the writes belong to.
    month = { ...MONTH, rows: [ROW, { ...ROW, employee_id: 'G1002', row_no: 2 }] }
    setTimesheetCell.mockImplementation((_p, body) =>
      Promise.resolve(accept(body.employee_id, body.day, body.code)),
    )
    renderPage()
    await screen.findByRole('table')

    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: cellOf(3) },
      { target: screen.getByRole('button', { name: /G1002 day 4 /i }) },
      { keys: '[/MouseLeft]' },
    ])

    await waitFor(() => expect(setTimesheetCell).toHaveBeenCalledTimes(4))
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    expect(toast.success).toHaveBeenCalledWith('4 cells — P')
  })

  /**
   * The load-bearing case. Two of four days are outside the roster window, so
   * the server takes two and refuses two — and the operator gets ONE line, not
   * one per refused day.
   */
  it('keeps the accepted days, reverts the refused ones, and says so once', async () => {
    const OFF_ROSTER = 'Day is outside the roster window for G1001.'
    setTimesheetCell.mockImplementation((_p, body) =>
      body.day <= 4
        ? Promise.reject(new Error(OFF_ROSTER))
        : Promise.resolve(accept(body.employee_id, body.day, body.code)),
    )
    renderPage()
    await screen.findByRole('table')

    // Arm a code first, so the sweep paints something other than what the
    // cells already hold and an accepted cell is visibly different. The side
    // glance lists the same meaning as a filter row, so the RIBBON's brush is
    // the one outside that column.
    const glance = screen.getByTestId('timesheet-glance')
    const brush = screen
      .getAllByRole('button', { name: /annual leave/i })
      .filter((node) => !glance.contains(node))
    expect(brush).toHaveLength(1)
    await userEvent.click(brush[0])
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: cellOf(3) },
      { target: cellOf(6) },
      { keys: '[/MouseLeft]' },
    ])

    await waitFor(() => expect(setTimesheetCell).toHaveBeenCalledTimes(4))

    // ONE message, carrying the count refused and the server's own sentence.
    // Four per-cell toasts is what `quiet` exists to prevent.
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining(OFF_ROSTER))
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('2'))
    // A partial refusal is not a success, so the run is not also confirmed.
    expect(toast.success).not.toHaveBeenCalled()

    // The two the server took are still painted; the two it refused went back
    // to the last value it confirmed. A wholesale rollback would undo all four.
    await waitFor(() => expect(cellOf(5)).toHaveAttribute('data-code', 'AL'))
    expect(cellOf(6)).toHaveAttribute('data-code', 'AL')
    expect(cellOf(3)).toHaveAttribute('data-code', 'P')
    expect(cellOf(4)).toHaveAttribute('data-code', 'P')

    // The record has to match what the server took. With all four left on the
    // stack the chip read `4 corrections` for two landed writes, and `Undo
    // last change` popped the REFUSED ones first — re-issuing `set_cell` for a
    // day the roster edge owns, non-quiet, so the operator collected an error
    // toast for undoing something that never happened, twice, before either
    // real correction was reachable.
    expect(screen.getByText('2 corrections')).toBeInTheDocument()
    setTimesheetCell.mockClear()
    vi.mocked(toast.error).mockClear()
    await userEvent.click(screen.getByRole('button', { name: /undo last change/i }))
    // Day 6 — the last cell the server accepted — restored to what it held
    // before the fill. Not day 4: that write was refused and is not a
    // correction.
    await waitFor(() => expect(setTimesheetCell).toHaveBeenCalledTimes(1))
    expect(setTimesheetCell.mock.calls[0][1]).toMatchObject({ day: 6, code: 'P' })
    expect(screen.getByText('1 correction')).toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reports a wholly refused sweep once as well', async () => {
    setTimesheetCell.mockRejectedValue(new Error('The month is closed.'))
    renderPage()
    await screen.findByRole('table')

    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: cellOf(10) },
      { target: cellOf(12) },
      { keys: '[/MouseLeft]' },
    ])

    await waitFor(() => expect(setTimesheetCell).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('The month is closed.'))
  })

  it('removes a refused picker correction from the undo stack', async () => {
    setTimesheetCell.mockRejectedValue(new Error('The month is closed.'))
    renderPage()
    await screen.findByRole('table')

    await userEvent.click(cellOf(3))
    await userEvent.click(screen.getByRole('menuitem', { name: /annual leave/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The month is closed.'))
    expect(screen.getByText('No corrections yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /undo last change/i })).toBeDisabled()
  })
})
