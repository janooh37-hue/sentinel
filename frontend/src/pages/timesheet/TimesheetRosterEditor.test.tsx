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
    // an open month are still correctable.
    await waitFor(() => expect(listDesignations).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Edit roster' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /annual leave/i })).toBeInTheDocument()
  })
})

describe('entering roster edit mode', () => {
  it('returns to attendance, disarms the brush, and protects the cells', async () => {
    renderPage()
    await screen.findByText('GUARD G7160')

    // Scoped to the variant switch: the dock names one of its files "Client
    // statistics" too, and both are buttons on this page.
    const deliverable = screen.getByRole('group', { name: 'Deliverable' })
    await userEvent.click(screen.getByRole('button', { name: /annual leave/i }))
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
    expect(screen.queryByRole('button', { name: /annual leave/i })).not.toBeInTheDocument()
    expect(screen.getByText('Annual leave')).toBeInTheDocument()

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
    // refetched — while the draft and the mode stay put.
    await waitFor(() => expect(listDesignations).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(getTimesheet).toHaveBeenCalledTimes(2))
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
})
