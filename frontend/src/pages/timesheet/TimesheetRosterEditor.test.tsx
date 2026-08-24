/**
 * Staged roster editing, end to end through the page (design §"Roster edit
 * interaction").
 *
 * `TimesheetRosterEditor` is the banner and the two catalog dialogs, but the
 * contract it exists to serve is a PAGE contract: the page owns `{ editing,
 * draft }`, the grid owns the grips and the drop bands, and the whole point is
 * that a move changes the printed order and nothing on the server until Save.
 * Testing the banner alone would prove none of that — it would prove that a
 * button calls its prop — so this suite renders `TimesheetPage` and drives the
 * real gesture.
 *
 * The api mock therefore names every method this page can now reach:
 * `listDesignations` (the catalog the affordance depends on) and
 * `setTimesheetRoster` (the one atomic write), beside the two the shell already
 * used. `sonner` carries `warning` as well, because a locked cell refuses
 * through the grid's own one-per-gesture toast rather than by going dead.
 *
 * jsdom has neither `DataTransfer` nor the Web Animations API, so the pointer
 * path is driven with a plain advisory `dataTransfer` object and the payload is
 * read from the grid's own drag ref — which is what the browser path relies on
 * anyway, since a `text/plain` payload is readable by any other drop target on
 * the page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('@/lib/api', () => ({
  api: {
    getTimesheet: vi.fn(),
    setTimesheetCell: vi.fn(),
    listDesignations: vi.fn(),
    setTimesheetRoster: vi.fn(),
    createTimesheetDesignation: vi.fn(),
    updateTimesheetDesignation: vi.fn(),
  },
  apiErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  // The structured envelope: a refusal this UI has its own words for is
  // recognised by CODE, so the sentence an Arabic operator reads is never the
  // backend's English one.
  ApiError: class ApiError extends Error {
    readonly code: string
    constructor(_status: number, code: string, message: string) {
      super(message)
      this.code = code
    }
  },
}))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: vi.fn() }))
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

import { ApiError, api } from '@/lib/api'
import type {
  TimesheetDesignationRead,
  TimesheetGridResponse,
  TimesheetRow,
} from '@/lib/api'
import i18n from '@/lib/i18n'
import { useCapabilities } from '@/lib/useCapabilities'

import { TimesheetPage } from './TimesheetPage'

function designation(
  id: number,
  rank: number,
  name_en: string,
  name_ar: string,
  sheet: string,
  active = true,
): TimesheetDesignationRead {
  return { id, name_en, name_ar, rank_order: rank, sheet, active, system_key: null }
}

// Ids offset from ranks, so an id/rank confusion cannot pass. `DRIVER` prints
// on the other workbook and `RETIRED` is inactive: neither is a valid target
// while the main sheet is on screen.
const DUTY = designation(105, 5, 'Duty In charge', 'مناوب عام', 'main')
const GUARD = designation(115, 15, 'Security Guard', 'حارس امن', 'main')
const MESSENGER = designation(114, 14, 'Messengers', 'حارس امن الارساليات', 'main')
const DRIVER = designation(116, 16, 'Driver', 'سائق', 'drivers')
const RETIRED = designation(120, 20, 'Armory Keeper', 'خازن سلاح', 'main', false)
const CATALOG = [DUTY, MESSENGER, GUARD, DRIVER, RETIRED]

function row(
  employee_id: string,
  row_no: number,
  from: TimesheetDesignationRead | null,
): TimesheetRow {
  return {
    employee_id,
    row_no,
    name_en: `GUARD ${employee_id}`,
    nationality_en: 'India',
    designation_en: from?.name_en ?? null,
    designation_ar: from?.name_ar ?? null,
    designation_id: from?.id ?? null,
    rank_order: from?.rank_order ?? null,
    codes: Array.from({ length: 31 }, () => 'P'),
    stat_codes: Array.from({ length: 31 }, () => 'P'),
    stat_block: 1,
    stat_filler: null,
    joined_day: null,
    left_day: null,
    start_confirmed: false,
    notes: {},
  }
}

// The main sheet as the server sends it: rank 5, then the rank-15 guards by
// G-number. `Messengers` (rank 14) has nobody — the vacancy a drop must still
// be able to land on.
const MONTH: TimesheetGridResponse = {
  year: 2026,
  month: 8,
  days_in_month: 31,
  sheet: 'main',
  post_count: 249,
  rows: [row('G6001', 1, DUTY), row('G7014', 2, GUARD), row('G7160', 3, GUARD)],
  blocking: [],
  warnings: [],
  removed: [],
  closed_at: null,
  closed_by: null,
}

/**
 * The same month with a block-2 row, for the statistics variant: the two blocks
 * are the only groups that sheet may have, so a staged order printed there
 * would either duplicate a block heading or file a man under the wrong one.
 */
const BLOCKED_MONTH: TimesheetGridResponse = {
  ...MONTH,
  rows: [
    ...MONTH.rows,
    {
      ...row('G7200', 4, GUARD),
      stat_block: 2,
      stat_filler: 'TR',
      stat_codes: Array.from({ length: 31 }, () => 'TR'),
    },
  ],
}

/**
 * The other deliverable, as the server sends it: one driver, under the one
 * designation that workbook has. Nobody printed here is printed on `MONTH`,
 * which is exactly why a move between the two needs a way to name a man who is
 * not on the sheet in front of you (design §"Draft and save", last paragraph).
 */
const DRIVERS_MONTH: TimesheetGridResponse = {
  ...MONTH,
  sheet: 'drivers',
  rows: [row('G9001', 1, DRIVER)],
}

const getTimesheet = vi.mocked(api.getTimesheet)
const listDesignations = vi.mocked(api.listDesignations)
const setTimesheetRoster = vi.mocked(api.setTimesheetRoster)
const setTimesheetCell = vi.mocked(api.setTimesheetCell)
const mockCapabilities = vi.mocked(useCapabilities)

function grant(...caps: string[]): void {
  const granted = new Set(caps)
  mockCapabilities.mockReturnValue({
    capabilities: granted as Set<never>,
    isLoading: false,
    has: ((cap: string) => granted.has(cap)) as never,
  } as never)
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
    qc,
    ...render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <TimesheetPage />
        </QueryClientProvider>
      </MemoryRouter>,
    ),
  }
}

/** The printed order on screen, which is the whole thing a move changes. */
const printed = (): string[] =>
  screen.getAllByTestId('timesheet-row').map((tr) => tr.dataset.employee ?? '')

/**
 * One day cell, by its accessible name. The TRAILING SPACE is load-bearing, as
 * in `TimesheetGrid.test.tsx`: without it `day 3` also matches day 30 and 31.
 */
const cell = (employeeId: string, day: number): HTMLElement =>
  screen.getByRole('button', { name: new RegExp(`${employeeId} day ${day} `, 'i') })

const grip = (employeeId: string): HTMLElement =>
  screen.getByRole('button', {
    name: new RegExp(`move ${employeeId} to another designation`, 'i'),
  })

/** The drop band of one designation, by the id the drop handler actually reads. */
const band = (id: number): HTMLElement => {
  const node = document.querySelector<HTMLElement>(`[data-ts-drop="${id}"]`)
  expect(node, `no drop band for designation ${id}`).not.toBeNull()
  return node as HTMLElement
}

/** One native drag, with the advisory payload jsdom cannot construct. */
function dragTo(source: HTMLElement, target: HTMLElement): void {
  const dataTransfer = {
    setData: vi.fn(),
    getData: vi.fn(() => ''),
    clearData: vi.fn(),
    dropEffect: 'none',
    effectAllowed: 'all',
  }
  fireEvent.dragStart(source, { dataTransfer })
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
  fireEvent.dragEnd(source, { dataTransfer })
}

/** Enters roster edit mode from a state where the affordance is present. */
async function enterRosterMode(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: 'Edit roster' }))
}

/** Answers each sheet with its own workbook, as the real endpoint does. */
function bothWorkbooks(main: TimesheetGridResponse = MONTH): void {
  getTimesheet.mockImplementation(async (asked: { sheet?: string }) =>
    asked.sheet === 'drivers' ? DRIVERS_MONTH : main,
  )
}

/** How many times ONE workbook was read — the sibling read is a call too. */
const loadsOf = (sheet: string): number =>
  getTimesheet.mock.calls.filter(([asked]) => (asked as { sheet?: string }).sheet === sheet).length

async function selectDriversSheet(): Promise<void> {
  const switcher = screen.getByRole('group', { name: 'Roster' })
  await userEvent.click(within(switcher).getByRole('button', { name: 'Drivers' }))
  await screen.findByText('GUARD G9001')
}

/** The two selects and the button that bring a man in from the other workbook. */
const crossGroup = (): HTMLElement =>
  screen.getByRole('group', { name: 'From the other workbook' })
const crossEmployee = (): HTMLSelectElement =>
  screen.getByLabelText('Employee to move') as HTMLSelectElement
const crossTarget = (): HTMLSelectElement =>
  screen.getByLabelText('Designation') as HTMLSelectElement
const crossStage = (): HTMLElement => screen.getByRole('button', { name: 'Stage move' })
const crossRemove = (employeeId: string): HTMLElement =>
  screen.getByRole('button', { name: `Take ${employeeId} back off this sheet` })
const optionsOf = (select: HTMLSelectElement): string[] =>
  Array.from(select.options).map((option) => option.textContent ?? '')

/** Chooses the target once, then the man — the order the operator works in. */
async function stageAcross(employeeId: string, designationId: number): Promise<void> {
  await userEvent.selectOptions(crossTarget(), String(designationId))
  await userEvent.selectOptions(crossEmployee(), employeeId)
  await userEvent.click(crossStage())
}

beforeEach(() => {
  vi.clearAllMocks()
  grant('timesheet.view', 'timesheet.edit')
  getTimesheet.mockResolvedValue(MONTH)
  listDesignations.mockResolvedValue(CATALOG)
  setTimesheetRoster.mockResolvedValue(undefined as never)
})

describe('roster edit affordance', () => {
  it('is absent for an operator who can only read the month', async () => {
    grant('timesheet.view')
    renderPage()
    await screen.findByText('GUARD G7160')

    expect(screen.queryByRole('button', { name: 'Edit roster' })).not.toBeInTheDocument()
  })

  it('is absent on a sealed month', async () => {
    getTimesheet.mockResolvedValue({
      ...MONTH,
      closed_at: '2026-09-01T06:00:00Z',
      closed_by: 'M. Rahman',
    })
    renderPage()
    await screen.findByText('GUARD G7160')

    expect(screen.queryByRole('button', { name: 'Edit roster' })).not.toBeInTheDocument()
  })

  it('is absent while the designation catalog has not loaded', async () => {
    listDesignations.mockRejectedValue(new Error('catalog is down'))
    renderPage()
    await screen.findByText('GUARD G7160')

    // A catalog failure costs the roster editor and nothing else: the cells of
    // an open month are still correctable. Counted past the side glance, which
    // lists the same eight meanings as filter rows.
    await waitFor(() => expect(listDesignations).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Edit roster' })).not.toBeInTheDocument()
    const glance = screen.getByTestId('timesheet-glance')
    expect(
      screen
        .getAllByRole('button', { name: /annual leave/i })
        .filter((node) => !glance.contains(node)),
    ).toHaveLength(1)
  })
})

describe('entering roster edit mode', () => {
  it('returns to attendance, disarms the brush, and protects the cells', async () => {
    renderPage()
    await screen.findByText('GUARD G7160')

    // Scoped to the variant switch: the dock names one of its files "Client
    // statistics" too, and both are buttons on this page. The ribbon's brush is
    // scoped the same way, past the side glance's own "Annual leave" filter row.
    const deliverable = screen.getByRole('group', { name: 'Deliverable' })
    const glance = screen.getByTestId('timesheet-glance')
    const brush = screen
      .getAllByRole('button', { name: /annual leave/i })
      .filter((node) => !glance.contains(node))
    expect(brush).toHaveLength(1)
    await userEvent.click(brush[0])
    await userEvent.click(within(deliverable).getByRole('button', { name: 'Client statistics' }))
    await enterRosterMode()

    // The roster is only meaningful on the attendance grid, and the statistics
    // variant is derived — so entering switches back rather than refusing.
    expect(within(deliverable).getByRole('button', { name: 'Attendance' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // The armed code is gone with the whole brush: the ribbon is the legend it
    // looks like again, not a disabled control that still answers Enter.
    expect(
      screen
        .queryAllByRole('button', { name: /annual leave/i })
        .filter((node) => !glance.contains(node)),
    ).toEqual([])
    expect(
      screen.getAllByText('Annual leave').filter((node) => !glance.contains(node)),
    ).toHaveLength(1)

    // A cell still answers — it is refused with the reason, never dead.
    await userEvent.click(cell('G7160', 3))
    expect(setTimesheetCell).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringMatching(/read-only while the roster/i),
      expect.anything(),
    )
  })
})

describe('staging a move', () => {
  it('reprints the sheet from a pointer drop without asking the server', async () => {
    renderPage()
    await screen.findByText('GUARD G7160')
    await enterRosterMode()

    expect(printed()).toEqual(['G6001', 'G7014', 'G7160'])
    dragTo(grip('G7160'), band(DUTY.id))

    // Rank 5 now holds two men, ordered by the number inside the G-number, and
    // every row number below the move has been recomputed.
    await waitFor(() => expect(printed()).toEqual(['G6001', 'G7160', 'G7014']))
    const moved = screen.getAllByTestId('timesheet-row')[1]
    expect(within(moved).getByText('Duty In charge')).toBeInTheDocument()
    expect(moved.querySelector('.ts-c-no')?.textContent).toBe('2')
    expect(setTimesheetRoster).not.toHaveBeenCalled()
  })

  it('stages the same move from the grip keyboard picker', async () => {
    renderPage()
    await screen.findByText('GUARD G7160')
    await enterRosterMode()

    grip('G7160').focus()
    await userEvent.keyboard('{Enter}')

    const picker = screen.getByRole('menu', { name: /move to designation/i })
    await userEvent.click(within(picker).getByRole('menuitem', { name: /duty in charge/i }))

    await waitFor(() => expect(printed()).toEqual(['G6001', 'G7160', 'G7014']))
    expect(setTimesheetRoster).not.toHaveBeenCalled()
    // Focus goes back to the control that opened the menu, so the next move is
    // one keystroke away instead of a tab from the top of the sheet.
    expect(document.activeElement).toBe(grip('G7160'))
  })

  it('offers only the active designations of the sheet on screen', async () => {
    renderPage()
    await screen.findByText('GUARD G7160')
    await enterRosterMode()

    grip('G7160').focus()
    await userEvent.keyboard('{Enter}')
    const picker = screen.getByRole('menu', { name: /move to designation/i })

    expect(within(picker).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Duty In charge',
      'Messengers',
      'Security Guard',
    ])
    // The drivers workbook is reached by selecting the drivers sheet, and an
    // inactive designation takes no new assignments.
    expect(within(picker).queryByRole('menuitem', { name: 'Driver' })).not.toBeInTheDocument()
    expect(
      within(picker).queryByRole('menuitem', { name: 'Armory Keeper' }),
    ).not.toBeInTheDocument()
    // The same set is the set of drop bands, vacancies included.
    expect(band(MESSENGER.id)).toBeInTheDocument()
    expect(document.querySelector(`[data-ts-drop="${DRIVER.id}"]`)).toBeNull()
    expect(document.querySelector(`[data-ts-drop="${RETIRED.id}"]`)).toBeNull()
  })
})

describe('saving the draft', () => {
  it('sends the changed assignments once, for the month on screen', async () => {
    renderPage()
    await screen.findByText('GUARD G7160')
    await enterRosterMode()

    dragTo(grip('G7160'), band(DUTY.id))
    await waitFor(() => expect(printed()).toEqual(['G6001', 'G7160', 'G7014']))
    // Moved and moved back: the draft entry goes with it, so Save must not
    // name a man whose designation the server already holds.
    dragTo(grip('G7014'), band(DUTY.id))
    await waitFor(() => expect(printed()).toEqual(['G6001', 'G7014', 'G7160']))
    dragTo(grip('G7014'), band(GUARD.id))
    await waitFor(() => expect(printed()).toEqual(['G6001', 'G7160', 'G7014']))

    await userEvent.click(screen.getByRole('button', { name: 'Save roster' }))

    const asked = getTimesheet.mock.calls[0][0] as { year: number; month: number }
    await waitFor(() =>
      expect(setTimesheetRoster).toHaveBeenCalledWith({
        year: asked.year,
        month: asked.month,
        assignments: [{ employee_id: 'G7160', designation_id: DUTY.id }],
      }),
    )
    expect(setTimesheetRoster).toHaveBeenCalledTimes(1)
    // Success closes the mode and drops the draft; the month refetches.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save roster' })).not.toBeInTheDocument(),
    )
    expect(await screen.findByRole('button', { name: 'Edit roster' })).toBeInTheDocument()
  })

  it('cannot be pressed twice while the batch is in flight', async () => {
    let land: () => void = () => {}
    setTimesheetRoster.mockReturnValue(
      new Promise<void>((resolve) => {
        land = () => resolve()
      }) as never,
    )
    renderPage()
    await screen.findByText('GUARD G7160')
    await enterRosterMode()
    dragTo(grip('G7160'), band(DUTY.id))
    await waitFor(() => expect(printed()).toEqual(['G6001', 'G7160', 'G7014']))

    const save = screen.getByRole('button', { name: 'Save roster' })
    await userEvent.click(save)
    await waitFor(() => expect(save).toBeDisabled())
    await userEvent.click(save)

    expect(setTimesheetRoster).toHaveBeenCalledTimes(1)
    land()
  })

  it('keeps the draft and the mode when the batch is refused, and says why once', async () => {
    setTimesheetRoster.mockRejectedValue(new Error('Designation 105 is inactive.'))
    renderPage()
    await screen.findByText('GUARD G7160')
    await enterRosterMode()
    dragTo(grip('G7160'), band(DUTY.id))
    await waitFor(() => expect(printed()).toEqual(['G6001', 'G7160', 'G7014']))

    await userEvent.click(screen.getByRole('button', { name: 'Save roster' }))

    // A refusal with no code of its own falls back to whatever the server
    // said, beside the draft it refused — ONCE, and in one place: the write is
    // asked for its quiet variant, so the sentence is not also a toast the
    // operator has to read twice and can only catch once.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Designation 105 is inactive.')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(toast.error).not.toHaveBeenCalled()
    // Nothing was rolled back: the staged order and the mode are both still on
    // screen, so the operator can retry or cancel.
    expect(printed()).toEqual(['G6001', 'G7160', 'G7014'])
    expect(screen.getByRole('button', { name: 'Save roster' })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Save roster' }))
    await waitFor(() => expect(setTimesheetRoster).toHaveBeenCalledTimes(2))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('answers a stale designation in its own words and reloads what went stale', async () => {
    setTimesheetRoster.mockRejectedValue(
      new ApiError(422, 'DESIGNATION_INACTIVE', 'Roster assignments require active designations.'),
    )
    renderPage()
    await screen.findByText('GUARD G7160')
    await enterRosterMode()
    dragTo(grip('G7160'), band(DUTY.id))
    await waitFor(() => expect(printed()).toEqual(['G6001', 'G7160', 'G7014']))

    await userEvent.click(screen.getByRole('button', { name: 'Save roster' }))

    // A code this UI has words for is answered in the interface's language,
    // not with the backend's English sentence — which is the whole reason the
    // envelope carries a code.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no longer takes new assignments/i)
    expect(alert).not.toHaveTextContent('Roster assignments require active designations.')
    // The catalog on screen is what went stale, so both it and the month are
    // refetched — while the draft and the mode stay put. Counted for the sheet
    // on screen: edit mode also reads the other workbook once, so a total would
    // no longer say which month was reloaded.
    await waitFor(() => expect(listDesignations).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(loadsOf('main')).toBe(2))
    expect(printed()).toEqual(['G6001', 'G7160', 'G7014'])
    expect(screen.getByRole('button', { name: 'Save roster' })).toBeEnabled()
  })

  it('answers a vanished employee in its own words and reloads the month', async () => {
    setTimesheetRoster.mockRejectedValue(
      new ApiError(404, 'EMPLOYEE_NOT_FOUND', "No employee 'G7160'."),
    )
    renderPage()
    await screen.findByText('GUARD G7160')
    await enterRosterMode()
    dragTo(grip('G7160'), band(DUTY.id))
    await waitFor(() => expect(printed()).toEqual(['G6001', 'G7160', 'G7014']))

    await userEvent.click(screen.getByRole('button', { name: 'Save roster' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no longer on file/i)
    expect(alert).not.toHaveTextContent("No employee 'G7160'.")
    // The sentence PROMISES a reload, so the reload has to happen: a man the
    // batch could not find is a row the sheet is still printing, and leaving
    // it there means the operator retries against the same stale month.
    await waitFor(() => expect(loadsOf('main')).toBe(2))
    await waitFor(() => expect(listDesignations).toHaveBeenCalledTimes(2))
    expect(printed()).toEqual(['G6001', 'G7160', 'G7014'])
    expect(screen.getByRole('button', { name: 'Save roster' })).toBeEnabled()
  })

  it('leaves edit mode when a refetch finds the month sealed', async () => {
    const { qc } = renderPage()
    await screen.findByText('GUARD G7160')
    await enterRosterMode()
    dragTo(grip('G7160'), band(DUTY.id))
    await waitFor(() => expect(printed()).toEqual(['G6001', 'G7160', 'G7014']))

    getTimesheet.mockResolvedValue({
      ...MONTH,
      closed_at: '2026-09-01T06:00:00Z',
      closed_by: 'M. Rahman',
    })
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['timesheet'] })
    })

    // Somebody else sealed the month underneath the draft. Staging further
    // moves against it would only collect refusals, so the mode ends and the
    // sheet goes back to the order the seal froze — with no request of its own.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save roster' })).not.toBeInTheDocument(),
    )
    expect(printed()).toEqual(['G6001', 'G7014', 'G7160'])
    expect(screen.queryByRole('button', { name: 'Edit roster' })).not.toBeInTheDocument()
    expect(setTimesheetRoster).not.toHaveBeenCalled()
  })
})

describe('cancelling the draft', () => {
  it('restores the server order without a request', async () => {
    renderPage()
    await screen.findByText('GUARD G7160')
    await enterRosterMode()
    dragTo(grip('G7160'), band(DUTY.id))
    await waitFor(() => expect(printed()).toEqual(['G6001', 'G7160', 'G7014']))

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(printed()).toEqual(['G6001', 'G7014', 'G7160'])
    expect(setTimesheetRoster).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Edit roster' })).toBeInTheDocument()
    // The cells are correctable again the moment roster mode ends.
    await userEvent.click(cell('G7160', 3))
    expect(screen.getByRole('menu', { name: 'Codes' })).toBeInTheDocument()
  })
})

describe('the other deliverable', () => {
  it('prints the server order in the statistics variant while the draft waits', async () => {
    getTimesheet.mockResolvedValue(BLOCKED_MONTH)
    renderPage()
    await screen.findByText('GUARD G7200')
    await enterRosterMode()
    dragTo(grip('G7160'), band(DUTY.id))
    await waitFor(() => expect(printed()).toEqual(['G6001', 'G7160', 'G7014', 'G7200']))

    const deliverable = screen.getByRole('group', { name: 'Deliverable' })
    await userEvent.click(within(deliverable).getByRole('button', { name: 'Client statistics' }))

    // The statistics sheet groups by BLOCK, not by designation. Printing the
    // staged order there files a man under a block heading he is not in and
    // splits the block he is, so this variant shows the server's own order —
    // exactly two block headings, in the order the response had.
    expect(printed()).toEqual(['G6001', 'G7014', 'G7160', 'G7200'])
    expect(screen.getAllByText(/block 1/i)).toHaveLength(1)
    expect(screen.getAllByText(/block 2/i)).toHaveLength(1)
    expect(
      screen.queryByRole('button', { name: /to another designation/i }),
    ).not.toBeInTheDocument()

    // Unprinted, not discarded: the attendance grid shows the draft again.
    await userEvent.click(within(deliverable).getByRole('button', { name: 'Attendance' }))
    expect(printed()).toEqual(['G6001', 'G7160', 'G7014', 'G7200'])
    expect(screen.getByRole('button', { name: 'Save roster' })).toBeEnabled()
  })
})

/**
 * Moving a man between the two deliverables (design §"Draft and save": "Only
 * designations belonging to the displayed workbook sheet are drop targets.
 * Moving an employee to the Drivers workbook is done while the Drivers sheet is
 * selected").
 *
 * That sentence assumes a path the drag bands cannot offer: a guard is not
 * printed on the drivers workbook, so there is nothing there to grab. This is
 * the path — name him, name the designation, stage it — and the sheet's own
 * drag bands and grip picker are untouched by it.
 */
describe('moving a man in from the other workbook', () => {
  it('reads the other workbook only while the roster is being edited', async () => {
    bothWorkbooks()
    renderPage()
    await screen.findByText('GUARD G7160')

    // Not staging anything: the page pays for the sheet on screen and nothing
    // else, however long it is left open.
    await waitFor(() => expect(loadsOf('main')).toBe(1))
    expect(loadsOf('drivers')).toBe(0)

    await enterRosterMode()
    await waitFor(() => expect(loadsOf('drivers')).toBe(1))

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await screen.findByRole('button', { name: 'Edit roster' })
    expect(loadsOf('drivers')).toBe(1)
  })

  it('names both choices, and offers only the other workbook and this sheet', async () => {
    bothWorkbooks()
    renderPage()
    await screen.findByText('GUARD G7160')
    await selectDriversSheet()
    await enterRosterMode()

    // The men come from the OTHER workbook, and G9001 is not among them: he is
    // already printed here, so offering him would stage a move to where he is.
    await waitFor(() =>
      expect(optionsOf(crossEmployee())).toEqual([
        'Choose…',
        'G6001 — GUARD G6001',
        'G7014 — GUARD G7014',
        'G7160 — GUARD G7160',
      ]),
    )
    // The targets are the sheet on screen's own active designations — the same
    // set the drop bands and the grip picker offer, and no wider.
    expect(optionsOf(crossTarget())).toEqual(['Choose…', 'Driver'])
  })

  it('stages the move onto this workbook without asking the server', async () => {
    bothWorkbooks()
    renderPage()
    await screen.findByText('GUARD G7160')
    await selectDriversSheet()
    await enterRosterMode()
    await waitFor(() => expect(optionsOf(crossEmployee())).toHaveLength(4))

    expect(printed()).toEqual(['G9001'])
    await userEvent.selectOptions(crossEmployee(), 'G7160')
    await userEvent.selectOptions(crossTarget(), String(DRIVER.id))
    await userEvent.click(crossStage())

    // He prints on the drivers workbook now, ahead of G9001 because the tie
    // inside a designation is the number in the G-number — and the server was
    // not asked. One move staged, not two.
    await waitFor(() => expect(printed()).toEqual(['G7160', 'G9001']))
    expect(screen.getByText('1 move staged')).toBeInTheDocument()
    expect(setTimesheetRoster).not.toHaveBeenCalled()
    // He is on this sheet now: the list he came from no longer holds him, and
    // the sheet's own grip does.
    expect(optionsOf(crossEmployee())).toEqual([
      'Choose…',
      'G6001 — GUARD G6001',
      'G7014 — GUARD G7014',
    ])
    expect(grip('G7160')).toBeInTheDocument()
  })

  it('sends the man and his new designation as one batch', async () => {
    bothWorkbooks()
    renderPage()
    await screen.findByText('GUARD G7160')
    await selectDriversSheet()
    await enterRosterMode()
    await waitFor(() => expect(optionsOf(crossEmployee())).toHaveLength(4))
    await userEvent.selectOptions(crossEmployee(), 'G7160')
    await userEvent.selectOptions(crossTarget(), String(DRIVER.id))
    await userEvent.click(crossStage())
    await waitFor(() => expect(printed()).toEqual(['G7160', 'G9001']))

    await userEvent.click(screen.getByRole('button', { name: 'Save roster' }))

    const asked = getTimesheet.mock.calls[0][0] as { year: number; month: number }
    await waitFor(() =>
      expect(setTimesheetRoster).toHaveBeenCalledWith({
        year: asked.year,
        month: asked.month,
        assignments: [{ employee_id: 'G7160', designation_id: DRIVER.id }],
      }),
    )
    expect(setTimesheetRoster).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save roster' })).not.toBeInTheDocument(),
    )
  })

  it('restores this workbook on Cancel, without a request', async () => {
    bothWorkbooks()
    renderPage()
    await screen.findByText('GUARD G7160')
    await selectDriversSheet()
    await enterRosterMode()
    await waitFor(() => expect(optionsOf(crossEmployee())).toHaveLength(4))
    await userEvent.selectOptions(crossEmployee(), 'G7160')
    await userEvent.selectOptions(crossTarget(), String(DRIVER.id))
    await userEvent.click(crossStage())
    await waitFor(() => expect(printed()).toEqual(['G7160', 'G9001']))

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(printed()).toEqual(['G9001'])
    expect(setTimesheetRoster).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Edit roster' })).toBeInTheDocument()
  })

  it('says the other workbook is still coming, and stages a same-sheet move meanwhile', async () => {
    let land: (grid: TimesheetGridResponse) => void = () => {}
    getTimesheet.mockImplementation(async (asked: { sheet?: string }) => {
      if (asked.sheet !== 'drivers') return MONTH
      return new Promise<TimesheetGridResponse>((resolve) => {
        land = resolve
      })
    })
    renderPage()
    await screen.findByText('GUARD G7160')
    await enterRosterMode()

    // Plainly said, and it blocks nothing: the sheet in front of the operator
    // is already loaded, so its own drag bands keep working.
    expect(await screen.findByText('Reading the other workbook…')).toBeInTheDocument()
    dragTo(grip('G7160'), band(DUTY.id))
    await waitFor(() => expect(printed()).toEqual(['G6001', 'G7160', 'G7014']))

    await act(async () => {
      land(DRIVERS_MONTH)
    })

    // Arrived: the driver is the man this workbook can take, and the targets
    // are the main sheet's three active designations.
    await waitFor(() =>
      expect(optionsOf(crossEmployee())).toEqual(['Choose…', 'G9001 — GUARD G9001']),
    )
    expect(optionsOf(crossTarget())).toEqual([
      'Choose…',
      'Duty In charge',
      'Messengers',
      'Security Guard',
    ])
  })

  it('says plainly when the other workbook has nobody left to move', async () => {
    getTimesheet.mockImplementation(async (asked: { sheet?: string }) =>
      asked.sheet === 'drivers' ? { ...DRIVERS_MONTH, rows: [] } : MONTH,
    )
    renderPage()
    await screen.findByText('GUARD G7160')
    await enterRosterMode()

    expect(
      await screen.findByText('The other workbook has nobody left to move here.'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Employee to move')).not.toBeInTheDocument()
    // The sheet on screen is still editable: an empty sibling costs this one
    // control and nothing else.
    dragTo(grip('G7160'), band(DUTY.id))
    await waitFor(() => expect(printed()).toEqual(['G6001', 'G7160', 'G7014']))
  })

  it('never offers or prints a man the sheet on screen already holds', async () => {
    // The window after a saved batch: both workbooks are invalidated, and the
    // one that has not answered yet still names the man the other now prints.
    getTimesheet.mockImplementation(async (asked: { sheet?: string }) =>
      asked.sheet === 'drivers'
        ? DRIVERS_MONTH
        : { ...MONTH, rows: [...MONTH.rows, row('G9001', 4, GUARD)] },
    )
    renderPage()
    await screen.findByText('GUARD G7160')
    await selectDriversSheet()
    await enterRosterMode()

    await waitFor(() =>
      expect(optionsOf(crossEmployee())).toEqual([
        'Choose…',
        'G6001 — GUARD G6001',
        'G7014 — GUARD G7014',
        'G7160 — GUARD G7160',
      ]),
    )
    expect(printed()).toEqual(['G9001'])
  })

  it('prints the first arrival onto a workbook the server has nobody on', async () => {
    // The bootstrap case: a Drivers workbook that has not been used yet. The
    // empty state is what the sheet shows, so an arrival that only appears
    // after Save is an arrival the operator stages blind.
    getTimesheet.mockImplementation(async (asked: { sheet?: string }) =>
      asked.sheet === 'drivers' ? { ...DRIVERS_MONTH, rows: [] } : MONTH,
    )
    renderPage()
    await screen.findByText('GUARD G7160')
    const switcher = screen.getByRole('group', { name: 'Roster' })
    await userEvent.click(within(switcher).getByRole('button', { name: 'Drivers' }))
    await screen.findByTestId('timesheet-empty')
    await enterRosterMode()
    await waitFor(() => expect(optionsOf(crossEmployee())).toHaveLength(4))

    await stageAcross('G7160', DRIVER.id)

    await waitFor(() => expect(printed()).toEqual(['G7160']))
    expect(screen.queryByTestId('timesheet-empty')).not.toBeInTheDocument()
    // On the sheet properly: the grip is what makes him re-targetable.
    expect(grip('G7160')).toBeInTheDocument()
    expect(setTimesheetRoster).not.toHaveBeenCalled()
  })

  it('refuses a chosen man the other workbook no longer offers', async () => {
    bothWorkbooks()
    const { qc } = renderPage()
    await screen.findByText('GUARD G7160')
    await selectDriversSheet()
    await enterRosterMode()
    await waitFor(() => expect(optionsOf(crossEmployee())).toHaveLength(4))
    await userEvent.selectOptions(crossTarget(), String(DRIVER.id))
    await userEvent.selectOptions(crossEmployee(), 'G7160')

    // He leaves the other workbook between the choice and the press — someone
    // else moved him, or he is off the roster entirely.
    getTimesheet.mockImplementation(async (asked: { sheet?: string }) =>
      asked.sheet === 'drivers'
        ? DRIVERS_MONTH
        : { ...MONTH, rows: MONTH.rows.filter((each) => each.employee_id !== 'G7160') },
    )
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['timesheet'] })
    })

    await waitFor(() =>
      expect(optionsOf(crossEmployee())).toEqual([
        'Choose…',
        'G6001 — GUARD G6001',
        'G7014 — GUARD G7014',
      ]),
    )
    // A stale id is not a move: the control that would send it is refused, and
    // nothing is staged for a man the list no longer holds.
    expect(crossStage()).toBeDisabled()
    expect(printed()).toEqual(['G9001'])
    expect(screen.getByText('Nothing staged')).toBeInTheDocument()
  })

  it('says the other workbook could not be read, and offers another try', async () => {
    getTimesheet.mockImplementation(async (asked: { sheet?: string }) => {
      if (asked.sheet === 'drivers') throw new Error('the drivers workbook is down')
      return MONTH
    })
    renderPage()
    await screen.findByText('GUARD G7160')
    await enterRosterMode()

    // A failed read is not an empty one: "nobody left to move" would be a
    // sentence about the roster, and this is a sentence about the network.
    const group = await screen.findByRole('group', { name: 'From the other workbook' })
    expect(
      within(group).getByText("Couldn't load this. Check your connection and try again."),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('The other workbook has nobody left to move here.'),
    ).not.toBeInTheDocument()
    // The sheet in front of the operator is loaded, so its own moves still work.
    dragTo(grip('G7160'), band(DUTY.id))
    await waitFor(() => expect(printed()).toEqual(['G6001', 'G7160', 'G7014']))

    bothWorkbooks()
    await userEvent.click(within(group).getByRole('button', { name: 'Retry' }))

    await waitFor(() =>
      expect(optionsOf(crossEmployee())).toEqual(['Choose…', 'G9001 — GUARD G9001']),
    )
  })

  it('keeps focus inside the picker after staging, with men left and with none', async () => {
    bothWorkbooks()
    renderPage()
    await screen.findByText('GUARD G7160')
    await selectDriversSheet()
    await enterRosterMode()
    await waitFor(() => expect(optionsOf(crossEmployee())).toHaveLength(4))
    const group = crossGroup()

    await stageAcross('G7160', DRIVER.id)

    // Staging disables the button that was just pressed, and a disabled active
    // element drops focus to the document body — which loses the keyboard
    // operator's place on a band they are about to use again.
    await waitFor(() => expect(document.activeElement).toBe(group))
    expect(crossStage()).toBeDisabled()

    await userEvent.selectOptions(crossEmployee(), 'G6001')
    await userEvent.click(crossStage())
    await userEvent.selectOptions(crossEmployee(), 'G7014')
    await userEvent.click(crossStage())

    // The last man takes the whole form with him; focus still has somewhere to
    // land, because the group itself is the stop.
    await waitFor(() =>
      expect(
        screen.getByText('The other workbook has nobody left to move here.'),
      ).toBeInTheDocument(),
    )
    expect(document.activeElement).toBe(group)
  })

  it('takes one staged arrival back off the sheet and leaves the rest', async () => {
    bothWorkbooks()
    renderPage()
    await screen.findByText('GUARD G7160')
    await selectDriversSheet()
    await enterRosterMode()
    await waitFor(() => expect(optionsOf(crossEmployee())).toHaveLength(4))

    await stageAcross('G7160', DRIVER.id)
    await userEvent.selectOptions(crossEmployee(), 'G6001')
    await userEvent.click(crossStage())
    await waitFor(() => expect(printed()).toEqual(['G6001', 'G7160', 'G9001']))
    expect(screen.getByText('2 moves staged')).toBeInTheDocument()
    const group = crossGroup()

    await userEvent.click(crossRemove('G7160'))

    // An arrival is the one staged move with no row to drag back, so it needs a
    // way out of its own — and it must take exactly ONE draft entry with it.
    await waitFor(() => expect(printed()).toEqual(['G6001', 'G9001']))
    expect(screen.getByText('1 move staged')).toBeInTheDocument()
    expect(optionsOf(crossEmployee())).toEqual([
      'Choose…',
      'G7014 — GUARD G7014',
      'G7160 — GUARD G7160',
    ])
    expect(crossRemove('G6001')).toBeInTheDocument()
    expect(setTimesheetRoster).not.toHaveBeenCalled()
    // Same focus contract: the control that answered has just unmounted.
    expect(document.activeElement).toBe(group)
  })
})

describe('reading the sheet in Arabic', () => {
  it('names the rename control from the designation Arabic prints', async () => {
    await i18n.changeLanguage('ar')
    try {
      renderPage()
      await screen.findByText('GUARD G7160')
      await userEvent.click(
        await screen.findByRole('button', { name: i18n.t('timesheet.rosterEdit.enter') }),
      )

      // The sentence is Arabic, so the name inside it has to be the Arabic one:
      // an Arabic label wrapped around an English designation is the exact
      // mixed-language leak the locale parity test cannot see.
      expect(
        screen.getByRole('button', { name: `تغيير اسم ${GUARD.name_ar}` }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: `تغيير اسم ${GUARD.name_en}` }),
      ).not.toBeInTheDocument()
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('reads the cross-workbook picker in Arabic and keeps the G-numbers LTR', async () => {
    bothWorkbooks()
    await i18n.changeLanguage('ar')
    try {
      renderPage()
      await screen.findByText('GUARD G7160')
      await userEvent.click(
        await screen.findByRole('button', { name: i18n.t('timesheet.rosterEdit.enter') }),
      )

      const employee = await screen.findByLabelText(
        i18n.t('timesheet.rosterEdit.cross.employee'),
      )
      expect(
        screen.getByLabelText(i18n.t('timesheet.rosterEdit.cross.target')),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: i18n.t('timesheet.rosterEdit.cross.stage') }),
      ).toBeInTheDocument()
      // The option is a G-number and an English name — data, not copy — so it
      // declares its own language and direction instead of inheriting the
      // Arabic paragraph's and reordering the id.
      const option = (employee as HTMLSelectElement).options[1]
      expect(option.textContent).toBe('G9001 — GUARD G9001')
      expect(option).toHaveAttribute('dir', 'ltr')
      expect(option).toHaveAttribute('lang', 'en')
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})
