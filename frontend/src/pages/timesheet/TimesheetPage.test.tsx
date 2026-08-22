/**
 * TimesheetPage — the A3 locked shell (UI spec §16.1).
 *
 * The contract under test is the shape, not the sheet: the page itself never
 * scrolls, the grid is the one scroll region, and the Employee section tabs and
 * the dock both sit outside it so reaching the release actions never means
 * scrolling 275 employees.
 *
 * Which month it opens on is pinned here too, against a faked clock: the roster
 * is corrected during the month, so the page opens on the month in progress and
 * not on the one that closed.
 *
 * `useSetCell`'s optimistic rollback is tested here too — a failed correction
 * that leaves the wrong code on screen is the one failure mode this page
 * cannot have, and Task 7 owns the mutation.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  api: {
    getTimesheet: vi.fn(),
    setTimesheetCell: vi.fn(),
    // The roster editor's gate (Task 6): the page reads the catalog to know
    // whether there is anything to drop onto, so every case here reaches it.
    listDesignations: vi.fn(),
  },
  apiErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))
// `useCapabilities` reads AuthContext, which throws outside <AuthProvider> —
// stub it as the house tests do (components/perms/CapabilityGate.test.tsx:18).
// A `vi.fn()` rather than a fixed value, because amendment A3's read-only page
// is only reachable by handing back `timesheet.view` WITHOUT `timesheet.edit`.
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: vi.fn() }))
// The band's tab badge reads today's attendance, whose query calls
// `api.listAttendanceDay` — absent from the api mock above, so an unmocked hook
// throws on every render. Stubbed as the directory suite does
// (EmployeeLookupPage.test.tsx:62).
vi.mock('@/components/employees/useAttendanceAttention', () => ({
  siteToday: () => '2026-08-22',
  useAttendanceAttention: () => ({
    allowed: false,
    isLoading: false,
    attention: null,
    seen: 0,
    late: 0,
    absent: 0,
    unpaired: 0,
    worst: [],
    judgedAt: new Date(0),
  }),
}))

import { api } from '@/lib/api'
import type { TimesheetGridResponse, TimesheetIssue, TimesheetRow } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import i18n from '@/lib/i18n'

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
const filterRow = (
  employee_id: string,
  row_no: number,
  name_en: string,
  designation_en: string,
  alDays: readonly number[],
): TimesheetRow => ({
  ...ROW,
  employee_id,
  row_no,
  name_en,
  designation_en,
  designation_ar: designation_en,
  codes: Array.from({ length: 31 }, (_, index) => (alDays.includes(index + 1) ? 'AL' : 'P')),
  stat_codes: Array.from({ length: 31 }, (_, index) => (alDays.includes(index + 1) ? 'AL' : 'P')),
})

const FILTER_ROWS: TimesheetRow[] = [
  filterRow('G7014', 1, 'MOHAMMED ASLAM', 'SECURITY GUARD', [1, 2]),
  filterRow('G7999', 2, 'UNMATCHED ROW', 'SECURITY GUARD', []),
  filterRow('G7068', 3, 'RAJESH KUMAR', 'SECURITY GUARD', [3]),
  filterRow('G7091', 4, 'SURESH DAS', 'MESSENGER', [4]),
  filterRow('G7120', 5, 'OMAR HASSAN', 'MESSENGER', [5]),
]

const FILTER_MONTH: TimesheetGridResponse = {
  ...EMPTY_MONTH,
  rows: FILTER_ROWS,
  days_in_month: 31,
}

/**
 * The same month with findings on it: one blocking check naming a man who HAS a
 * row (so the glance can jump to it) and one warning naming a man who does not
 * (`departed_but_active` is recomputed live and deliberately reports those).
 */
const CHECK_MONTH: TimesheetGridResponse = {
  ...FILTER_MONTH,
  blocking: [{ employee_id: 'G7091', kind: 'no_designation', detail: 'G7091 SURESH DAS' }],
  warnings: [
    {
      employee_id: 'G6001',
      kind: 'departed_but_active',
      detail: 'OMAR SAEED finished on 2026-05-31 but is still Active.',
    },
  ],
}
const DESIGNATION = {
  id: 1,
  name_en: 'SECURITY GUARD',
  name_ar: 'حارس أمن',
  rank_order: 1,
  sheet: 'main',
  active: true,
  system_key: null,
}



/** A recomputed blocking check — the kind of fact only the server can supply. */
const ISSUE: TimesheetIssue = {
  employee_id: 'G1001',
  kind: 'unconfirmed_start',
  detail: 'Starting point not accepted.',
}

const getTimesheet = vi.mocked(api.getTimesheet)
const setTimesheetCell = vi.mocked(api.setTimesheetCell)
const listDesignations = vi.mocked(api.listDesignations)
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
  if (!globalThis.CSS?.escape) {
    Object.defineProperty(globalThis, 'CSS', {
      configurable: true,
      value: {
        ...(globalThis.CSS ?? {}),
        escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`),
      },
    })
  }
  vi.clearAllMocks()
  grantAll()
  getTimesheet.mockResolvedValue(EMPTY_MONTH)
  // Empty on purpose: the roster affordance is Task 6's own suite's subject,
  // and this file's cases are the shell. An empty catalog is also the honest
  // default for a month with no rows.
  listDesignations.mockResolvedValue([])
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

  it('keeps the Employee section tabs outside the scroll region', async () => {
    renderPage()
    const grid = await screen.findByTestId('timesheet-scroll')
    const tabs = screen.getByRole('navigation', { name: 'Employees sections' })
    // The band is chrome, not content: scrolling the roster must never scroll
    // the way back out of the time sheet.
    expect(grid).not.toContainElement(tabs)
    // The paper is the dedicated sheet, not this layout. A named `@page` forces
    // a break, so an in-flow box left visible beside it costs a blank sheet.
    expect(tabs.closest('[data-print-hide]')).not.toBeNull()
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

    // The day-header band, held open at the grid's own `--ts-head`. Without it
    // the roster drops by the header's height as the month lands — measured in
    // Chromium, 34px at every zoom stop, a bigger jump than any per-row drift.
    // A SIBLING of the skeleton and never a child, so the one-element-per-row
    // shape above still holds: 14 children, all rows.
    const band = screen.getByTestId('timesheet-skeleton-head')
    expect(band.style.blockSize).toBe('var(--ts-head)')
    expect(rows).not.toContain(band)
    expect(band.nextElementSibling).toBe(skeleton)

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

    // The side glance prints the same eight meanings as a filter list, so both
    // assertions below are about the RIBBON and have to say so: an unscoped
    // query would find the glance's own "Annual leave" row and pass, or throw
    // on two matches, without ever looking at the legend.
    const glance = screen.getByTestId('timesheet-glance')

    // The ribbon is the legend it looks like. Not a disabled button: a disabled
    // control still answers Enter and Space (UI spec §14).
    expect(
      screen.getAllByText('Annual leave').filter((node) => !glance.contains(node)),
    ).toHaveLength(1)
    expect(
      screen.queryAllByRole('button', { name: /annual leave/i }).filter(
        (node) => !glance.contains(node),
      ),
    ).toEqual([])
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

describe('TimesheetPage month', () => {
  beforeEach(() => {
    // Date only: faking the whole timer set starves react-query and `waitFor`,
    // which is why EmployeeIdCard.test.tsx pins the clock exactly this way.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 22))
  })
  afterEach(() => vi.useRealTimers())

  it('opens on the month in progress, not the one that closed', async () => {
    renderPage()
    await screen.findByTestId('timesheet-shell')

    // 22 Aug 2026 — `lastCompletedMonth()` would have asked for July.
    await waitFor(() =>
      expect(getTimesheet).toHaveBeenCalledWith({ year: 2026, month: 8, sheet: 'main' }),
    )
  })
})

describe('TimesheetPage code filtering', () => {
  async function activateAnnualLeave(user: UserEvent) {
    await user.click(screen.getByRole('button', { name: /cells by code/i }))
    const panel = await screen.findByRole('region', { name: /cells by code/i })
    await user.click(within(panel).getByRole('button', { name: /annual leave/i }))
    expect(await screen.findByTestId('code-filter-bar')).toBeInTheDocument()
  }

  it('activates AL with employee and cell totals, wraps both directions, and scrolls the viewport', async () => {
    getTimesheet.mockResolvedValue(FILTER_MONTH)
    const user = userEvent.setup()
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    renderPage()
    await screen.findByText('MOHAMMED ASLAM')

    await activateAnnualLeave(user)
    expect(screen.getByText('4 employees')).toBeInTheDocument()
    expect(screen.getByText('5 cells')).toBeInTheDocument()
    expect(screen.getByTestId('code-filter-bar')).toHaveTextContent('G7014')
    expect(screen.getByText('1 of 4')).toBeInTheDocument()
    expect(screen.getAllByTestId('timesheet-row')).toHaveLength(4)
    expect(screen.getAllByTestId('timesheet-headcount')[0]).toHaveTextContent('4')

    await user.click(screen.getByRole('button', { name: /previous employee/i }))
    expect(screen.getByText('4 of 4')).toBeInTheDocument()
    expect(scroll).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
    expect(
      screen.getByTestId('timesheet-scroll').querySelector('tr[data-employee="G7120"]'),
    ).not.toBeNull()

    await user.click(screen.getByRole('button', { name: /next employee/i }))
    expect(screen.getByText('1 of 4')).toBeInTheDocument()
    scroll.mockRestore()
  })

  it('shows zero-match codes disabled and Clear or variant changes restore the full sheet', async () => {
    getTimesheet.mockResolvedValue(FILTER_MONTH)
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('MOHAMMED ASLAM')

    await user.click(screen.getByRole('button', { name: /cells by code/i }))
    const panel = await screen.findByRole('region', { name: /cells by code/i })
    expect(within(panel).getByRole('button', { name: /sick leave/i })).toBeDisabled()
    await user.click(within(panel).getByRole('button', { name: /annual leave/i }))
    await screen.findByTestId('code-filter-bar')

    await user.click(screen.getByRole('button', { name: /clear filter/i }))
    expect(screen.queryByTestId('code-filter-bar')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('timesheet-row')).toHaveLength(5)

    await activateAnnualLeave(user)
    await user.click(
      within(screen.getByRole('group', { name: 'Deliverable' })).getByRole('button', {
        name: /client statistics/i,
      }),
    )
    expect(screen.queryByTestId('code-filter-bar')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('timesheet-row')).toHaveLength(5)
  })
  it('centers a selected row without competing with filter scrolling', async () => {
    getTimesheet.mockResolvedValue(FILTER_MONTH)
    const user = userEvent.setup()
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    renderPage()
    await screen.findByText('MOHAMMED ASLAM')

    await user.click(screen.getByRole('button', { name: /select G7014/i }))
    expect(scroll).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'smooth' })
    scroll.mockRestore()
  })

  it('focuses the filter announcement once and pulses an actual primary outline', async () => {
    getTimesheet.mockResolvedValue(FILTER_MONTH)
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
    const animate = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate,
    })
    try {
      const user = userEvent.setup()
      renderPage()
      await screen.findByText('MOHAMMED ASLAM')
      await activateAnnualLeave(user)

      const bar = screen.getByTestId('code-filter-bar')
      expect(bar).toHaveAttribute('tabindex', '-1')
      expect(document.activeElement).toBe(bar)
      expect(screen.getByRole('group', { name: /filtered by annual leave/i })).toBe(bar)
      expect(animate).toHaveBeenCalled()
      expect(JSON.stringify(animate.mock.calls[0]?.[0])).toContain('var(--primary)')

      await user.click(screen.getByRole('button', { name: /next employee/i }))
      expect(document.activeElement).not.toBe(bar)
    } finally {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, 'animate', descriptor)
      else delete (HTMLElement.prototype as HTMLElement & { animate?: unknown }).animate
    }
  })

  it('does not let roster edit retain or regain a code filter', async () => {
    getTimesheet.mockResolvedValue(FILTER_MONTH)
    listDesignations.mockResolvedValue([DESIGNATION])
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('MOHAMMED ASLAM')
    await user.click(await screen.findByRole('button', { name: /edit roster/i }))
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()

    const codes = screen.getByRole('button', { name: /cells by code/i })
    expect(codes).toBeDisabled()
    expect(screen.queryByRole('region', { name: /cells by code/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('code-filter-bar')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('timesheet-row')).toHaveLength(5)
    // The side offers the same filter, so roster mode has to refuse it in both
    // places: a live-looking code row calling a callback the page ignores is
    // the dead control amendment A3 forbids.
    const side = screen.getByTestId('timesheet-glance')
    expect(within(side).getByRole('button', { name: /annual leave/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByTestId('code-filter-bar')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('timesheet-row')).toHaveLength(5)
  })
  it('closes and disables the bottom code surface when roster edit starts', async () => {
    getTimesheet.mockResolvedValue(FILTER_MONTH)
    listDesignations.mockResolvedValue([DESIGNATION])
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('MOHAMMED ASLAM')
    await user.click(screen.getByRole('button', { name: /cells by code/i }))
    expect(await screen.findByRole('region', { name: /cells by code/i })).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /edit roster/i }))
    expect(screen.queryByRole('region', { name: /cells by code/i })).not.toBeInTheDocument()
    const codes = screen.getByRole('button', { name: /cells by code/i })
    expect(codes).toBeDisabled()
    codes.focus()
    expect(document.activeElement).not.toBe(codes)
  })
})

/**
 * The side glance, in place (design §"Side glance"): the second column of the
 * sheet body, the 36px rail, standing down for a bottom panel, and the two
 * things it is the way into — the checks and the shared code filter.
 */
describe('TimesheetPage side glance', () => {
  /**
   * One `matchMedia` for the two media queries this page asks about — the
   * narrow default and reduced motion. `setup.ts` answers `matches: false` to
   * everything, so a case that needs either one has to say so here.
   */
  function media(matching: RegExp): () => void {
    const original = window.matchMedia
    window.matchMedia = ((query: string) =>
      ({
        matches: matching.test(query),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList) as typeof window.matchMedia
    return () => {
      window.matchMedia = original
    }
  }

  beforeEach(() => {
    getTimesheet.mockResolvedValue(CHECK_MONTH)
  })

  it('seats the glance beside the sheet at 210px, on the codes view', async () => {
    renderPage()
    await screen.findByText('MOHAMMED ASLAM')

    const body = screen.getByTestId('timesheet-body')
    const glance = screen.getByTestId('timesheet-glance')
    expect(body.className).toContain('grid-cols-[minmax(0,1fr)_210px]')
    // Second column in the DOM and in the grid, which is what puts it at the
    // inline END in both directions without a mirrored rule.
    expect(body.lastElementChild).toBe(glance)
    // Outside the sheet's own scroller: the column scrolls itself, and the one
    // scroll region on the page stays the grid's.
    expect(screen.getByTestId('timesheet-scroll')).not.toContainElement(glance)
    expect(within(glance).getByTestId('code-badge-AL')).toHaveAttribute('data-code', 'AL')
    expect(within(glance).getByRole('button', { name: /^codes$/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('starts on the rail at narrow widths and keeps the view across a collapse', async () => {
    const restore = media(/max-width/)
    try {
      const user = userEvent.setup()
      renderPage()
      await screen.findByText('MOHAMMED ASLAM')
      expect(screen.getByTestId('timesheet-body').className).toContain(
        'grid-cols-[minmax(0,1fr)_36px]',
      )
      expect(screen.queryByTestId('glance-code-AL')).not.toBeInTheDocument()

      // Explicit state persists: reopening is the operator's answer, and
      // nothing re-collapses it behind them.
      await user.click(screen.getByTestId('glance-toggle'))
      expect(screen.getByTestId('timesheet-body').className).toContain(
        'grid-cols-[minmax(0,1fr)_210px]',
      )

      await user.click(screen.getByRole('button', { name: /^checks/i }))
      expect(screen.getByText('G7091 SURESH DAS')).toBeInTheDocument()
      await user.click(screen.getByTestId('glance-toggle'))
      await user.click(screen.getByTestId('glance-toggle'))
      // The view survived the round trip: still Checks, not back to codes.
      expect(screen.getByRole('button', { name: /^checks/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(screen.getByText('G7091 SURESH DAS')).toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('stands the glance down to zero for a bottom panel and restores the rail', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('MOHAMMED ASLAM')

    await user.click(screen.getByTestId('glance-toggle'))
    expect(screen.getByTestId('timesheet-body').className).toContain(
      'grid-cols-[minmax(0,1fr)_36px]',
    )

    await user.click(screen.getByRole('button', { name: /cells by code/i }))
    expect(await screen.findByRole('region', { name: /cells by code/i })).toBeInTheDocument()
    const hidden = screen.getByTestId('timesheet-glance')
    expect(screen.getByTestId('timesheet-body').className).toContain(
      'grid-cols-[minmax(0,1fr)_0px]',
    )
    expect(hidden).toHaveAttribute('inert')
    expect(within(hidden).queryByTestId('glance-toggle')).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: /cells by code/i })).not.toBeInTheDocument()
    // The state it had before the panel, not a fresh one.
    expect(screen.getByTestId('timesheet-body').className).toContain(
      'grid-cols-[minmax(0,1fr)_36px]',
    )
    expect(screen.getByTestId('glance-toggle')).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the glance on Checks from the fix-before-download notice', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('MOHAMMED ASLAM')

    // The worst case the notice has to undo: a bottom panel covering the sheet
    // and the column collapsed to its rail.
    await user.click(screen.getByTestId('glance-toggle'))
    await user.click(screen.getByRole('button', { name: /cells by code/i }))
    await screen.findByRole('region', { name: /cells by code/i })

    await user.click(screen.getByRole('button', { name: /fix before download/i }))
    expect(screen.queryByRole('region', { name: /cells by code/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('timesheet-body').className).toContain(
      'grid-cols-[minmax(0,1fr)_210px]',
    )
    expect(screen.getByRole('button', { name: /^checks/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('G7091 SURESH DAS')).toBeInTheDocument()
  })

  it('filters from the bottom panel and the side through one page filter', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('MOHAMMED ASLAM')

    await user.click(screen.getByTestId('glance-toggle'))
    await user.click(screen.getByRole('button', { name: /cells by code/i }))
    const panel = await screen.findByRole('region', { name: /cells by code/i })
    await user.click(within(panel).getByRole('button', { name: /annual leave/i }))

    // Closes the panel, restores the side on codes, then filters — in that
    // order, so the operator never loses sight of what was pressed.
    expect(screen.queryByRole('region', { name: /cells by code/i })).not.toBeInTheDocument()
    expect(await screen.findByTestId('code-filter-bar')).toBeInTheDocument()
    expect(screen.getByTestId('timesheet-body').className).toContain(
      'grid-cols-[minmax(0,1fr)_210px]',
    )
    const glance = screen.getByTestId('timesheet-glance')
    expect(within(glance).getByRole('button', { name: /^codes$/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(glance).getByRole('button', { name: /annual leave/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getAllByTestId('timesheet-row')).toHaveLength(4)

    // The same code from the side is the same one filter, not a second one.
    await user.click(screen.getByRole('button', { name: /clear filter/i }))
    expect(screen.getAllByTestId('timesheet-row')).toHaveLength(5)
    await user.click(within(glance).getByRole('button', { name: /annual leave/i }))
    expect(await screen.findByTestId('code-filter-bar')).toBeInTheDocument()
    expect(screen.getAllByTestId('timesheet-row')).toHaveLength(4)
  })

  it('jumps to the row of a finding, and jumps again on a repeat', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
    const animate = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate,
    })
    try {
      const user = userEvent.setup()
      renderPage()
      await screen.findByText('MOHAMMED ASLAM')
      const glance = screen.getByTestId('timesheet-glance')

      // A filter on, so the jump has one to clear.
      await user.click(within(glance).getByRole('button', { name: /annual leave/i }))
      expect(screen.getAllByTestId('timesheet-row')).toHaveLength(4)
      await user.click(within(glance).getByRole('button', { name: /^checks/i }))

      const line = screen.getByTestId('check-issue-G7091')
      scroll.mockClear()
      animate.mockClear()
      await user.click(within(line).getByRole('button', { name: /show row/i }))

      expect(screen.queryByTestId('code-filter-bar')).not.toBeInTheDocument()
      expect(screen.getAllByTestId('timesheet-row')).toHaveLength(5)
      expect(
        screen.getByTestId('timesheet-scroll').querySelector('tr[data-employee="G7091"]'),
      ).toHaveAttribute('data-selected', '1')
      expect(scroll).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
      expect(animate).toHaveBeenCalledTimes(1)

      // The same man, again. Nothing about the page's state changed, so without
      // a fresh cue the second press is dead — which is the whole point of it.
      const before = scroll.mock.calls.length
      await user.click(within(line).getByRole('button', { name: /show row/i }))
      expect(scroll.mock.calls.length).toBeGreaterThan(before)
      expect(animate).toHaveBeenCalledTimes(2)
    } finally {
      scroll.mockRestore()
      if (descriptor) Object.defineProperty(HTMLElement.prototype, 'animate', descriptor)
      else delete (HTMLElement.prototype as HTMLElement & { animate?: unknown }).animate
    }
  })

  it('centres the jumped row without the pulse when motion is reduced', async () => {
    const restore = media(/prefers-reduced-motion/)
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
    const animate = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate,
    })
    try {
      const user = userEvent.setup()
      renderPage()
      await screen.findByText('MOHAMMED ASLAM')
      await user.click(screen.getByRole('button', { name: /^checks/i }))
      scroll.mockClear()
      await user.click(
        within(screen.getByTestId('check-issue-G7091')).getByRole('button', {
          name: /show row/i,
        }),
      )
      expect(scroll).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
      expect(animate).not.toHaveBeenCalled()
    } finally {
      scroll.mockRestore()
      restore()
      if (descriptor) Object.defineProperty(HTMLElement.prototype, 'animate', descriptor)
      else delete (HTMLElement.prototype as HTMLElement & { animate?: unknown }).animate
    }
  })

  describe('under ar', () => {
    beforeAll(async () => {
      await i18n.changeLanguage('ar')
    })
    afterAll(async () => {
      await i18n.changeLanguage('en')
    })

    it('keeps the glance at the inline end, with no physical offsets', async () => {
      renderPage()
      await screen.findByText('MOHAMMED ASLAM')
      expect(document.documentElement.dir).toBe('rtl')

      const body = screen.getByTestId('timesheet-body')
      const glance = screen.getByTestId('timesheet-glance')
      // Grid tracks follow the writing direction, so the second track IS the
      // inline end in Arabic — one declaration, mirrored by the engine.
      expect(body.lastElementChild).toBe(glance)
      expect(body.className).toContain('grid-cols-[minmax(0,1fr)_210px]')
      const physical = [glance, ...Array.from(glance.querySelectorAll('*'))]
        .flatMap((node) => Array.from((node as HTMLElement).classList))
        .map((token) => token.slice(token.lastIndexOf(':') + 1))
        .filter((token) => /^(?:m[lr]|p[lr]|border-[lr]|left|right)-/.test(token))
      expect(physical).toEqual([])
    })
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
