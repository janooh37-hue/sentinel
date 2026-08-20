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
// stub it as the house tests do (components/perms/CapabilityGate.test.tsx:18).
// A `vi.fn()` rather than a fixed value, because amendment A3's read-only page
// is only reachable by handing back `timesheet.view` WITHOUT `timesheet.edit`.
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: vi.fn() }))

import { api } from '@/lib/api'
import type { TimesheetGridResponse, TimesheetIssue, TimesheetRow } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'

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

/** A recomputed blocking check — the kind of fact only the server can supply. */
const ISSUE: TimesheetIssue = {
  employee_id: 'G1001',
  kind: 'unconfirmed_start',
  detail: 'Starting point not accepted.',
}

const getTimesheet = vi.mocked(api.getTimesheet)
const setTimesheetCell = vi.mocked(api.setTimesheetCell)
const mockCapabilities = vi.mocked(useCapabilities)

/** Everything, i.e. a manager: the default for every case but the A3 one. */
function grantAll(): void {
  mockCapabilities.mockReturnValue({
    capabilities: new Set(['timesheet.view', 'timesheet.edit']),
    isLoading: false,
    has: () => true,
  })
}

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
  grantAll()
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
    // Scoped to the head. `timesheet.emptyReason` also says "JD 908" and
    // `EmptyState` renders it as a `<p>` with a direct text child, so a bare
    // /JD 908/ is two candidates the moment the flush order shifts.
    expect(screen.getByText(/monthly deliverables · site JD 908/i)).toBeInTheDocument()
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
    // The PITCH is the contract with Task 8's grid: no container padding, no
    // gaps, each row exactly `var(--row)`, and the day strip flush against the
    // identity block. A 6px row gap is 84px of drift over 14 rows, and the
    // month visibly jumps into place when it lands (locked rule 6).
    expect(skeleton.className).not.toMatch(/(?:^|\s)p-/)
    expect(skeleton.className).not.toMatch(/(?:^|\s)gap-/)
    const rows = Array.from(skeleton.children) as HTMLElement[]
    expect(rows).toHaveLength(14)
    for (const row of rows) {
      expect(row.style.blockSize).toBe('var(--row)')
      expect(row.className).not.toMatch(/(?:^|\s)gap-/)
      expect((row.firstElementChild as HTMLElement).className).toContain(
        'w-[var(--id-block)]',
      )
    }

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

  // Amendment A3: `timesheet.view` alone must still be a USABLE page, not a
  // page of dead controls.
  it('hands a view-only operator the legend, the reason, and no edit affordance', async () => {
    mockCapabilities.mockReturnValue({
      capabilities: new Set(['timesheet.view']),
      isLoading: false,
      has: (cap) => cap === 'timesheet.view',
    })
    renderPage()
    await screen.findByTestId('timesheet-shell')

    // The ribbon is the legend it looks like. Not a disabled button: a disabled
    // control still answers Enter and Space (UI spec §14).
    expect(screen.getByText('Annual leave')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /annual leave/i })).not.toBeInTheDocument()
    // No <kbd> either: there is no shortcut to teach when there is no brush.
    expect(document.querySelectorAll('kbd')).toHaveLength(0)

    // The hint names the missing permission instead of leaving them to wonder.
    expect(screen.getByText(/reading only/i)).toBeInTheDocument()
    expect(screen.queryByText(/arm a code/i)).not.toBeInTheDocument()

    // No edit-only furniture: a viewer can never push onto the stack, so the
    // chip and its permanently dead undo are not rendered.
    expect(screen.queryByText('No corrections yet')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /undo last change/i }),
    ).not.toBeInTheDocument()

    // Still complete: the month stepper and both roster/deliverable controls.
    expect(screen.getAllByRole('button', { name: /previous month/i }).length).toBeGreaterThan(0)
    expect(screen.getByRole('group', { name: 'Roster' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Deliverable' })).toBeInTheDocument()
  })
})

describe('useSetCell', () => {
  const params = { year: 2026, month: 7, sheet: 'main' } as const

  /**
   * Returns the client as well as the hook. The hook's rendered value lags the
   * cache by a render, so an end-state assertion that must not be satisfied by
   * a stale paint reads the cache directly.
   */
  function renderCellHook() {
    const qc = makeQc()
    const rendered = renderHook(
      () => ({ read: useTimesheetGrid(params), write: useSetCell(params) }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={qc}>{children}</QueryClientProvider>
        ),
      },
    )
    const cachedCode = (day: number) =>
      qc.getQueryData<TimesheetGridResponse>(['timesheet', 2026, 7, 'main'])?.rows[0]
        .codes[day - 1]
    return { ...rendered, qc, cachedCode }
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

  // The load-bearing case for Task 8, whose whole job is drag-to-fill: two
  // writes from one gesture, the second one refused.
  it('keeps a succeeded write\u2019s server answer when a queued write then fails', async () => {
    getTimesheet.mockResolvedValue({ ...EMPTY_MONTH, rows: [ROW] })
    // The server's answer to the FIRST write. Its recomputed month facts are
    // the ones the release decision is made from, and nothing local can
    // reproduce them.
    const servedFirst: TimesheetGridResponse = {
      ...EMPTY_MONTH,
      post_count: 250,
      blocking: [ISSUE],
      rows: [{ ...ROW, codes: ROW.codes.map((c, i) => (i === 2 ? 'AL' : c)) }],
    }

    const inFlight: {
      resolve: (grid: TimesheetGridResponse) => void
      reject: (err: Error) => void
    }[] = []
    setTimesheetCell.mockImplementation(
      () =>
        new Promise<TimesheetGridResponse>((resolve, reject) => {
          inFlight.push({ resolve, reject })
        }),
    )

    const { result } = renderCellHook()
    await waitFor(() => expect(result.current.read.rows).toHaveLength(1))

    act(() => {
      result.current.write.mutate({ employeeId: 'G1001', day: 3, code: 'AL' })
      result.current.write.mutate({ employeeId: 'G1001', day: 4, code: 'SL ' })
    })
    // Both cells paint at once — the scope holds the REQUEST back, not the fill.
    await waitFor(() => {
      expect(result.current.read.rows[0].codes[2]).toBe('AL')
      expect(result.current.read.rows[0].codes[3]).toBe('SL ')
    })
    expect(setTimesheetCell).toHaveBeenCalledTimes(1)

    await act(async () => {
      inFlight[0].resolve(servedFirst)
    })
    // The server's counts landed, and the queued cell was NOT un-painted.
    await waitFor(() => expect(result.current.read.postCount).toBe(250))
    expect(result.current.read.blocking).toHaveLength(1)
    expect(result.current.read.rows[0].codes[3]).toBe('SL ')
    await waitFor(() => expect(inFlight).toHaveLength(2))

    await act(async () => {
      inFlight[1].reject(new Error('Day 4 is outside the month.'))
    })
    // ONE cell goes back. The first write's server answer survives it: a
    // wholesale snapshot restore would put 249 and zero blocking checks back on
    // screen, which is the release decision made from a grid nobody sent.
    await waitFor(() => expect(result.current.read.rows[0].codes[3]).toBe('P'))
    expect(result.current.read.rows[0].codes[2]).toBe('AL')
    expect(result.current.read.postCount).toBe(250)
    expect(result.current.read.blocking).toHaveLength(1)
    expect(toast.error).toHaveBeenCalledWith('Day 4 is outside the month.')
  })

  /**
   * Two writes to ONE cell, both refused. Reachable from the shipped Undo
   * button, which re-issues the same cell, and from any second click on a cell
   * whose first write has not answered — and both refusals are the ordinary
   * case once the month is sealed or an `edit` grant has gone stale.
   */
  it('leaves the last confirmed code, not the first refusal\u2019s, when both writes fail', async () => {
    getTimesheet.mockResolvedValue({ ...EMPTY_MONTH, rows: [ROW] })
    const inFlight: { reject: (err: Error) => void }[] = []
    setTimesheetCell.mockImplementation(
      () => new Promise<TimesheetGridResponse>((_resolve, reject) => { inFlight.push({ reject }) }),
    )

    const { result, cachedCode } = renderCellHook()
    await waitFor(() => expect(result.current.read.rows).toHaveLength(1))

    // Two ticks, one cell — the shipped Undo route, and any second click on a
    // cell whose first write has not answered. The first write's paint is
    // already in the cache when the second reads it.
    act(() => {
      result.current.write.mutate({ employeeId: 'G1001', day: 3, code: 'AL' })
    })
    await waitFor(() => expect(result.current.read.rows[0].codes[2]).toBe('AL'))
    act(() => {
      result.current.write.mutate({ employeeId: 'G1001', day: 3, code: 'SL ' })
    })
    await waitFor(() => expect(result.current.read.rows[0].codes[2]).toBe('SL '))
    await act(async () => {
      inFlight[0].reject(new Error('The month is closed.'))
    })
    await waitFor(() => expect(inFlight).toHaveLength(2))
    await act(async () => {
      inFlight[1].reject(new Error('The month is closed.'))
    })

    // 'P' is the last thing the server confirmed. 'AL' would be the first
    // refusal's code — refused twice, and still on screen.
    //
    // Read from the CACHE, and only once both refusals have been reported. The
    // cell legitimately passes through 'P' after the first refusal, and the
    // hook's rendered value lags the cache by a render, so polling the rendered
    // value for 'P' passes on that stale paint even when the second refusal
    // ends on 'AL'. `onError` writes the cache before it toasts, so two toasts
    // means the second revert has already landed.
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2))
    expect(cachedCode(3)).toBe('P')
  })

  it('rolls a refused write back to an accepted one, not to what preceded it', async () => {
    getTimesheet.mockResolvedValue({ ...EMPTY_MONTH, rows: [ROW] })
    // The first write is ACCEPTED, so 'AL' is confirmed for day 3.
    const servedFirst: TimesheetGridResponse = {
      ...EMPTY_MONTH,
      rows: [{ ...ROW, codes: ROW.codes.map((c, i) => (i === 2 ? 'AL' : c)) }],
    }
    const inFlight: {
      resolve: (grid: TimesheetGridResponse) => void
      reject: (err: Error) => void
    }[] = []
    setTimesheetCell.mockImplementation(
      () =>
        new Promise<TimesheetGridResponse>((resolve, reject) => {
          inFlight.push({ resolve, reject })
        }),
    )

    const { result, cachedCode } = renderCellHook()
    await waitFor(() => expect(result.current.read.rows).toHaveLength(1))

    act(() => {
      result.current.write.mutate({ employeeId: 'G1001', day: 3, code: 'AL' })
    })
    await waitFor(() => expect(result.current.read.rows[0].codes[2]).toBe('AL'))
    act(() => {
      result.current.write.mutate({ employeeId: 'G1001', day: 3, code: 'SL ' })
    })
    await waitFor(() => expect(result.current.read.rows[0].codes[2]).toBe('SL '))

    await act(async () => {
      inFlight[0].resolve(servedFirst)
    })
    await waitFor(() => expect(inFlight).toHaveLength(2))
    await act(async () => {
      inFlight[1].reject(new Error('Sick leave needs a note.'))
    })

    // Back to the ACCEPTED 'AL'. Rolling back to 'P' would discard a correction
    // the server had already taken — which is what a baseline inherited at
    // mutate time says, so the accepted answer has to overwrite it.
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(cachedCode(3)).toBe('AL')
    expect(toast.error).toHaveBeenCalledWith('Sick leave needs a note.')
  })
})
