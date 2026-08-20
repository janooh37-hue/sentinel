/**
 * TimesheetPage — the A3 locked shell (UI spec §16.1).
 *
 * The contract under test is the shape, not the sheet: the page itself never
 * scrolls, the grid is the one scroll region, and the dock sits outside it so
 * reaching the release actions never means scrolling 275 employees.
 *
 * `useSetCell`'s optimistic rollback is tested here too — a failed correction
 * that leaves the wrong code on screen is the one failure mode this page
 * cannot have, and Task 7 owns the mutation.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  api: {
    getTimesheet: vi.fn(),
    setTimesheetCell: vi.fn(),
  },
  apiErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))
// `useCapabilities` reads AuthContext, which throws outside <AuthProvider> —
// stub it as the house tests do (components/notify/SendButton.test.tsx:9).
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: () => true, isLoading: false }),
}))

import { api } from '@/lib/api'
import type { TimesheetGridResponse, TimesheetRow } from '@/lib/api'

import { TimesheetPage } from './TimesheetPage'
import { useSetCell, useTimesheetGrid } from './useTimesheet'

const EMPTY_MONTH: TimesheetGridResponse = {
  year: 2026,
  month: 7,
  days_in_month: 31,
  sheet: 'main',
  post_count: 249,
  rows: [],
  blocking: [],
  warnings: [],
  removed: [],
  closed_at: null,
  closed_by: null,
}

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
}

const getTimesheet = vi.mocked(api.getTimesheet)
const setTimesheetCell = vi.mocked(api.setTimesheetCell)

function makeQc(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={makeQc()}>
        <TimesheetPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  getTimesheet.mockResolvedValue(EMPTY_MONTH)
})

describe('TimesheetPage shell', () => {
  it('scrolls the grid and nothing else', async () => {
    renderPage()
    const page = await screen.findByTestId('timesheet-shell')
    const grid = await screen.findByTestId('timesheet-scroll')
    expect(page.className).toContain('overflow-hidden')
    expect(grid.className).toContain('overflow-auto')
    expect(grid.className).toContain('flex-1')
    // A flex child only yields its intrinsic height when its min-size is
    // released. `min-block-size-0` is not a Tailwind utility and compiles to
    // nothing, so assert the class that actually emits `min-height: 0`.
    expect(page.className).toContain('min-h-0')
    expect(grid.className).toContain('min-h-0')
  })

  it('keeps the dock outside the scroll region', async () => {
    renderPage()
    const grid = await screen.findByTestId('timesheet-scroll')
    expect(grid).not.toContainElement(await screen.findByTestId('timesheet-dock'))
  })

  it('names the month and the site in the head', async () => {
    renderPage()
    expect(
      await screen.findByRole('heading', { name: /monthly time sheet/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/JD 908/)).toBeInTheDocument()
  })

  it('renders at /employees/timesheet instead of the employee detail route', async () => {
    render(
      <MemoryRouter initialEntries={['/employees/timesheet']}>
        <QueryClientProvider client={makeQc()}>
          <Routes>
            <Route path="/employees/timesheet" element={<TimesheetPage />} />
            <Route path="/employees/:id" element={<div data-testid="detail-stub" />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('timesheet-shell')).toBeInTheDocument()
    expect(screen.queryByTestId('detail-stub')).not.toBeInTheDocument()
  })

  it('holds the sheet metrics while the month loads, then drops the skeleton', async () => {
    let release: (grid: TimesheetGridResponse) => void = () => {}
    getTimesheet.mockReturnValue(
      new Promise<TimesheetGridResponse>((resolve) => {
        release = resolve
      }),
    )
    renderPage()
    const skeleton = await screen.findByTestId('timesheet-skeleton')
    // The identity block and the 31 day columns are already known, so the
    // skeleton is laid out on the same metrics the grid will use (UI spec §9).
    expect(skeleton.style.getPropertyValue('--ts-days')).toBe('31')
    act(() => release(EMPTY_MONTH))
    await waitFor(() =>
      expect(screen.queryByTestId('timesheet-skeleton')).not.toBeInTheDocument(),
    )
  })

  it('states why the roster is empty and keeps the month stepper reachable', async () => {
    renderPage()
    expect(
      await screen.findByText(/no one was employed at JD 908 in this month/i),
    ).toBeInTheDocument()
    const stepper = screen.getByTestId('timesheet-empty')
    expect(
      await screen.findAllByRole('button', { name: /previous month/i }),
    ).toHaveLength(2)
    expect(stepper).toContainElement(
      screen.getAllByRole('button', { name: /previous month/i })[1],
    )
  })
})

describe('useSetCell', () => {
  const params = { year: 2026, month: 7, sheet: 'main' } as const

  function renderCellHook() {
    const qc = makeQc()
    return renderHook(
      () => ({ read: useTimesheetGrid(params), write: useSetCell(params) }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={qc}>{children}</QueryClientProvider>
        ),
      },
    )
  }

  it('paints the cell before the server answers and keeps the server grid', async () => {
    getTimesheet.mockResolvedValue({ ...EMPTY_MONTH, rows: [ROW] })
    const served: TimesheetGridResponse = {
      ...EMPTY_MONTH,
      rows: [{ ...ROW, codes: ROW.codes.map((c, i) => (i === 2 ? 'AL' : c)) }],
    }
    let release: (grid: TimesheetGridResponse) => void = () => {}
    setTimesheetCell.mockReturnValue(
      new Promise<TimesheetGridResponse>((resolve) => {
        release = resolve
      }),
    )

    const { result } = renderCellHook()
    await waitFor(() => expect(result.current.read.rows).toHaveLength(1))

    act(() => {
      result.current.write.mutate({ employeeId: 'G1001', day: 3, code: 'AL' })
    })
    await waitFor(() => expect(result.current.read.rows[0].codes[2]).toBe('AL'))

    await act(async () => {
      release(served)
    })
    await waitFor(() => expect(result.current.read.rows[0].codes[2]).toBe('AL'))
    expect(getTimesheet).toHaveBeenCalledTimes(1) // the write answered with the grid
  })

  it('restores the previous code and surfaces the server message on failure', async () => {
    getTimesheet.mockResolvedValue({ ...EMPTY_MONTH, rows: [ROW] })
    let reject: (err: Error) => void = () => {}
    setTimesheetCell.mockReturnValue(
      new Promise<TimesheetGridResponse>((_resolve, rej) => {
        reject = rej
      }),
    )

    const { result } = renderCellHook()
    await waitFor(() => expect(result.current.read.rows).toHaveLength(1))

    act(() => {
      result.current.write.mutate({ employeeId: 'G1001', day: 3, code: 'AB' })
    })
    await waitFor(() => expect(result.current.read.rows[0].codes[2]).toBe('AB'))

    await act(async () => {
      reject(new Error('The month is closed.'))
    })
    await waitFor(() => expect(result.current.read.rows[0].codes[2]).toBe('P'))
    expect(toast.error).toHaveBeenCalledWith('The month is closed.')
  })
})
