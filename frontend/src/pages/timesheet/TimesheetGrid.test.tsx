/**
 * The sheet itself — 31 columns, cell-as-button, picker, brush, drag-to-fill,
 * row counts (UI spec §§5–8, §16).
 *
 * A non-navigating component test, so the wrapper is nothing at all: the grid
 * takes props and reads i18n, which `src/test/setup.ts` initialises with `en`.
 * jsdom has no layout and does not load Tailwind, so every geometry claim here
 * is an assertion on a declared width — which is exactly why the widths are
 * declared inline on the header row (UI spec §5, `table-layout: fixed`) instead
 * of hidden in a stylesheet the test cannot see.
 */
import { readFileSync } from 'node:fs'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import type { TimesheetRow } from '@/lib/api'

import { ID_COLUMNS, TimesheetGrid, TimesheetMasthead } from './TimesheetGrid'

const row: TimesheetRow = {
  employee_id: 'G1001',
  row_no: 1,
  name_en: 'TEST GUARD',
  nationality_en: 'U.A.E',
  designation_en: 'Security Guard',
  designation_ar: 'حارس امن',
  rank_order: 15,
  codes: Array.from({ length: 31 }, () => 'P'),
  stat_codes: Array.from({ length: 31 }, () => 'P'),
  stat_block: 1,
  stat_filler: null,
  joined_day: null,
  left_day: null,
  start_confirmed: false,
  notes: {},
}

const props = {
  rows: [row],
  year: 2026,
  month: 7,
  daysInMonth: 31,
  variant: 'attendance' as const,
  closed: false,
  canEdit: true,
  brush: null,
  selected: null,
  edited: undefined,
  blocking: [],
  postCount: 0,
  onSetCell: vi.fn(),
  onFill: vi.fn(),
  onSelect: vi.fn(),
}

const cell = (id: string, day: number): HTMLElement =>
  screen.getByRole('button', { name: new RegExp(`${id} day ${day} `, 'i') })

const at = (employeeId: string, day: number) => ({ employeeId, day })

describe('TimesheetGrid', () => {
  it('renders 31 day columns and blanks the days a 30-day month lacks', () => {
    const { rerender } = render(<TimesheetGrid {...props} />)
    expect(screen.getAllByRole('columnheader', { name: /^31/ })).toHaveLength(1)
    rerender(
      <TimesheetGrid
        {...props}
        month={6}
        daysInMonth={30}
        rows={[{ ...row, codes: [...Array.from({ length: 30 }, () => 'P'), null] }]}
      />,
    )
    expect(screen.getAllByRole('columnheader', { name: /^31/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /G1001 day 30/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /G1001 day 31/i })).not.toBeInTheDocument()
    // The column stays so the grid cannot reflow between months (UI spec §5),
    // and its header says so.
    expect(screen.getByRole('columnheader', { name: /^31/ })).toHaveAttribute('data-out', '1')
  })

  it('does not render the printed totals columns', () => {
    render(<TimesheetGrid {...props} />)
    expect(screen.queryByRole('columnheader', { name: /total day/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /^off$/i })).not.toBeInTheDocument()
  })

  it('reports a plain code immediately', async () => {
    const onSetCell = vi.fn()
    render(<TimesheetGrid {...props} onSetCell={onSetCell} />)
    await userEvent.click(cell('G1001', 3))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: /annual leave/i }))
    expect(onSetCell).toHaveBeenCalledWith('G1001', 3, 'AL')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clears a cell from the picker', async () => {
    const onSetCell = vi.fn()
    render(<TimesheetGrid {...props} onSetCell={onSetCell} />)
    await userEvent.click(cell('G1001', 4))
    await userEvent.click(screen.getByRole('menuitem', { name: /clear cell/i }))
    expect(onSetCell).toHaveBeenCalledWith('G1001', 4, null)
  })

  it('collects an optional note when marking absence', async () => {
    const onSetCell = vi.fn()
    render(<TimesheetGrid {...props} onSetCell={onSetCell} />)
    await userEvent.click(cell('G1001', 3))
    await userEvent.click(screen.getByRole('menuitem', { name: /absence/i }))
    // A menu may hold menuitems, not textboxes, so the popover stops being one.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: /note/i }), 'no show')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSetCell).toHaveBeenCalledWith('G1001', 3, 'AB', 'no show')
  })

  it('paints the focused cell from the keyboard with the code letter', async () => {
    const onSetCell = vi.fn()
    render(<TimesheetGrid {...props} onSetCell={onSetCell} />)
    cell('G1001', 5).focus()
    await userEvent.keyboard('x')
    expect(onSetCell).toHaveBeenCalledWith('G1001', 5, 'X')
  })

  it('returns focus to the cell when the picker is dismissed', async () => {
    render(<TimesheetGrid {...props} />)
    const target = cell('G1001', 7)
    await userEvent.click(target)
    expect(target).not.toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(target).toHaveFocus()
  })

  it("shows that row's code counts on hover", async () => {
    render(<TimesheetGrid {...props} />)
    await userEvent.hover(cell('G1001', 2))
    const tally = await screen.findByRole('status')
    expect(tally).toHaveTextContent('G1001')
    expect(tally).toHaveTextContent('31')
  })

  it('offers no editing once the month is closed', async () => {
    const onSetCell = vi.fn()
    render(<TimesheetGrid {...props} closed onSetCell={onSetCell} />)
    const target = cell('G1001', 3)
    await userEvent.click(target)
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    // `pointer-events: none` would not stop this one (UI spec §14).
    target.focus()
    await userEvent.keyboard('a')
    expect(onSetCell).not.toHaveBeenCalled()
  })

  it('refuses edits in the statistics variant', async () => {
    const onSetCell = vi.fn()
    render(<TimesheetGrid {...props} variant="statistics" onSetCell={onSetCell} />)
    const target = cell('G1001', 3)
    target.focus()
    await userEvent.keyboard('a')
    await userEvent.click(target)
    expect(onSetCell).not.toHaveBeenCalled()
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('badges a joiner and a leaver with the reason', () => {
    render(
      <TimesheetGrid
        {...props}
        rows={[
          { ...row, employee_id: 'G2001', joined_day: 12 },
          { ...row, employee_id: 'G2002', row_no: 2, left_day: 17 },
        ]}
      />,
    )
    expect(screen.getByTitle(/started on day 12/i)).toBeInTheDocument()
    expect(screen.getByTitle(/last worked day 17/i)).toBeInTheDocument()
    expect(screen.getByText('new')).toBeInTheDocument()
    expect(screen.getByText('to 17')).toBeInTheDocument()
  })

  it('flips a joiner badge to the confirmed day once the start is acknowledged', () => {
    render(
      <TimesheetGrid
        {...props}
        rows={[{ ...row, employee_id: 'G2001', joined_day: 12, start_confirmed: true }]}
      />,
    )
    expect(screen.getByText('from 12')).toBeInTheDocument()
    expect(screen.queryByText('new')).not.toBeInTheDocument()
  })

  // ---------------------------------------------------------------- geometry

  it('declares the pitch Task 7 locked, out of the shared tokens', () => {
    render(<TimesheetGrid {...props} rows={[row, { ...row, employee_id: 'G1002', row_no: 2 }]} />)
    const table = screen.getByRole('table')
    // Not `max-content`: measured in Chromium on the locked mockup, a
    // fixed-layout table sized `max-content` hands ~5px of leftover to one
    // identity column (nationality rendered 87px against a declared 82px) and
    // the day strip then starts 5px past `--id-block`. Declaring the exact sum
    // makes the offset arithmetic instead of a rounding artefact.
    expect(table.style.inlineSize).toBe('calc(var(--id-block) + var(--cell) * 31)')

    const headers = screen.getAllByRole('columnheader')
    const identity = headers.slice(0, ID_COLUMNS.length)
    expect(identity.map((th) => th.style.inlineSize)).toEqual(
      ID_COLUMNS.map((token) => `var(${token})`),
    )
    const days = headers.slice(ID_COLUMNS.length)
    expect(days).toHaveLength(31)
    for (const day of days) expect(day.style.inlineSize).toBe('var(--cell)')

    for (const tr of screen.getAllByTestId('timesheet-row')) {
      expect(tr.style.blockSize).toBe('var(--row)')
    }
  })

  it('keeps --id-block the sum of the five identity columns it is built from', () => {
    // The token is the ONE place the identity width lives, so the loading
    // skeleton (`w-[var(--id-block)]`) and this grid cannot drift apart. If a
    // column width moves, the token has to follow it in the same edit.
    const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8')
    const sum = ID_COLUMNS.map((token) => `var(${token})`).join(' + ')
    expect(css).toContain(`--id-block: calc(${sum});`)
  })

  // ------------------------------------------------------------- drag to fill

  it('commits a swept rectangle once, through onFill', async () => {
    const onFill = vi.fn()
    const onSetCell = vi.fn()
    render(<TimesheetGrid {...props} brush="AL" onFill={onFill} onSetCell={onSetCell} />)
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: cell('G1001', 3) },
      { target: cell('G1001', 5) },
      { keys: '[/MouseLeft]' },
    ])
    expect(onFill).toHaveBeenCalledTimes(1)
    expect(onFill).toHaveBeenCalledWith([at('G1001', 3), at('G1001', 4), at('G1001', 5)], 'AL')
    // Committing per move would repaint the grid and tear the cell out from
    // under the pointer, so nothing goes through onSetCell.
    expect(onSetCell).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('sweeps rows as well as days, and with no brush uses the anchor code', async () => {
    const onFill = vi.fn()
    render(
      <TimesheetGrid
        {...props}
        onFill={onFill}
        rows={[
          { ...row, codes: Array.from({ length: 31 }, () => 'TR') },
          { ...row, employee_id: 'G1002', row_no: 2 },
        ]}
      />,
    )
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: cell('G1001', 9) },
      { target: cell('G1002', 10) },
      { keys: '[/MouseLeft]' },
    ])
    expect(onFill).toHaveBeenCalledWith(
      [at('G1001', 9), at('G1001', 10), at('G1002', 9), at('G1002', 10)],
      'TR',
    )
  })

  it('cancels the sweep on Escape without filling anything', async () => {
    const onFill = vi.fn()
    render(<TimesheetGrid {...props} brush="AL" onFill={onFill} />)
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: cell('G1001', 3) },
      { target: cell('G1001', 8) },
    ])
    await userEvent.keyboard('{Escape}')
    await userEvent.pointer([{ keys: '[/MouseLeft]' }])
    expect(onFill).not.toHaveBeenCalled()
  })

  it('shift-clicks the inclusive run from the last painted day', async () => {
    const onFill = vi.fn()
    const onSetCell = vi.fn()
    render(<TimesheetGrid {...props} brush="AL" onFill={onFill} onSetCell={onSetCell} />)
    await userEvent.click(cell('G1001', 6))
    expect(onSetCell).toHaveBeenCalledWith('G1001', 6, 'AL')
    await userEvent.click(cell('G1001', 9), { shiftKey: true })
    expect(onFill).toHaveBeenCalledWith(
      [at('G1001', 6), at('G1001', 7), at('G1001', 8), at('G1001', 9)],
      'AL',
    )
  })

  it('leaves the roster edges out of a fill and refuses to paint them', async () => {
    const onFill = vi.fn()
    const onSetCell = vi.fn()
    // NG covers days 1-2 and `-` covers days 6-31: the roster edge owns them,
    // and the server refuses an override there (TIMESHEET_OFF_ROSTER).
    render(
      <TimesheetGrid
        {...props}
        brush="AL"
        onFill={onFill}
        onSetCell={onSetCell}
        rows={[{ ...row, joined_day: 3, left_day: 5 }]}
      />,
    )
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: cell('G1001', 1) },
      { target: cell('G1001', 8) },
      { keys: '[/MouseLeft]' },
    ])
    expect(onFill).toHaveBeenCalledWith([at('G1001', 3), at('G1001', 4), at('G1001', 5)], 'AL')

    await userEvent.click(cell('G1001', 1))
    expect(onSetCell).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  // ------------------------------------------------------------- other states

  it('marks an edited cell structurally, not only by fill', () => {
    render(<TimesheetGrid {...props} edited={new Set(['G1001|3'])} />)
    expect(cell('G1001', 3)).toHaveAttribute('data-edited', '1')
    expect(cell('G1001', 4)).not.toHaveAttribute('data-edited')
  })

  it('reads stat_codes and draws the two blocks in the statistics variant', () => {
    render(
      <TimesheetGrid
        {...props}
        variant="statistics"
        rows={[
          { ...row, stat_codes: Array.from({ length: 31 }, () => 'P') },
          {
            ...row,
            employee_id: 'G1002',
            row_no: 2,
            stat_block: 2,
            stat_filler: 'TR',
            stat_codes: Array.from({ length: 31 }, () => 'TR'),
          },
        ]}
      />,
    )
    expect(cell('G1002', 3)).toHaveAttribute('data-code', 'TR')
    expect(screen.getByText(/block 1/i)).toBeInTheDocument()
    expect(screen.getByText(/block 2/i)).toBeInTheDocument()
    // The two printed blank rows between the blocks, drawn as one band.
    expect(screen.getByTestId('timesheet-block-gap')).toBeInTheDocument()
  })

  it('counts the posts manned per day and flags a day under contract', () => {
    render(
      <TimesheetGrid
        {...props}
        postCount={2}
        rows={[
          row,
          {
            ...row,
            employee_id: 'G1002',
            row_no: 2,
            codes: ['P', 'AL', ...Array.from({ length: 29 }, () => 'P')],
          },
        ]}
      />,
    )
    const footer = screen.getAllByTestId('timesheet-headcount')
    expect(footer[0]).toHaveTextContent('2')
    expect(footer[0]).not.toHaveAttribute('data-low')
    expect(footer[1]).toHaveTextContent('1')
    expect(footer[1]).toHaveAttribute('data-low', '1')
  })

  it('flags the row a blocking check names, and ignores a check with no row', () => {
    render(
      <TimesheetGrid
        {...props}
        blocking={[
          { employee_id: 'G1001', kind: 'nationality_unmapped', detail: 'Nationality has no mapping' },
          // `warnings`/`blocking` are recomputed live even on a closed month, so
          // an issue may name somebody with no row here at all.
          { employee_id: 'G9999', kind: 'designation_missing', detail: 'No designation on file' },
        ]}
      />,
    )
    expect(screen.getByRole('img', { name: /nationality has no mapping/i })).toBeInTheDocument()
    expect(screen.queryByText(/no designation on file/i)).not.toBeInTheDocument()
  })

  it('hands a view-only operator a readable grid with no edit affordance', async () => {
    const onSetCell = vi.fn()
    const onFill = vi.fn()
    render(
      <TimesheetGrid
        {...props}
        canEdit={false}
        brush="AL"
        onSetCell={onSetCell}
        onFill={onFill}
        rows={[{ ...row, joined_day: 12 }]}
      />,
    )
    const target = cell('G1001', 3)
    expect(target).toHaveAttribute('data-code', 'P')
    await userEvent.click(target)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target },
      { target: cell('G1001', 6) },
      { keys: '[/MouseLeft]' },
    ])
    expect(onSetCell).not.toHaveBeenCalled()
    expect(onFill).not.toHaveBeenCalled()
    // Still complete: the badge and the row counts are reading, not editing.
    expect(screen.getByText('new')).toBeInTheDocument()
    await userEvent.hover(target)
    expect(await screen.findByRole('status')).toHaveTextContent('G1001')
  })

  it('names the row so the panels can be pointed at it', async () => {
    const onSelect = vi.fn()
    render(<TimesheetGrid {...props} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: /select G1001/i }))
    expect(onSelect).toHaveBeenCalledWith('G1001')
  })

  it('unselects the row that is already selected', async () => {
    const onSelect = vi.fn()
    render(<TimesheetGrid {...props} selected="G1001" onSelect={onSelect} />)
    const handle = screen.getByRole('button', { name: /select G1001/i })
    expect(handle).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(handle)
    expect(onSelect).toHaveBeenCalledWith(null)
  })
})

describe('TimesheetMasthead', () => {
  it('quotes the printed workbook header, month and all', () => {
    render(<TimesheetMasthead year={2026} month={7} />)
    expect(screen.getByText(/as it prints/i)).toBeInTheDocument()
    const quote = screen.getByTestId('timesheet-masthead-quote')
    expect(quote).toHaveTextContent('Global Security Service Group- MONTHLY  TIME SHEET')
    expect(quote).toHaveTextContent('Site Name :   JD 908')
    // The one part that varies, and the reason the band is not a static image.
    expect(screen.getByText('JUL-2026')).toBeInTheDocument()
  })

  it('wraps the quotation instead of opening a second scroll region', () => {
    render(<TimesheetMasthead year={2026} month={2} />)
    const quote = screen.getByTestId('timesheet-masthead-quote')
    // UI spec §4 says `pre-wrap` for this band; the mockup used `pre` plus
    // `overflow-x: auto`, which is a second scrollable region on a page whose
    // whole point is that only the grid scrolls (§16.1).
    expect(quote.className).toContain('whitespace-pre-wrap')
    expect(quote.className).not.toMatch(/overflow-(x-)?auto/)
    expect(screen.getByText('FEB-2026')).toBeInTheDocument()
  })
})
