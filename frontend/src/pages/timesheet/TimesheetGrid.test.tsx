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
/// <reference types="node" />
// Node's own typings, for THIS file only. `tsconfig.app.json` pins
// `types: ["vite/client"]` so application code cannot reach `process` or `fs`
// by accident, and that guard is worth keeping — a reference directive opts one
// file in without widening it for the other 300.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import type { TimesheetRow } from '@/lib/api'

import { TimesheetGrid, TimesheetMasthead } from './TimesheetGrid'
import { ID_COLUMNS } from './columns'

/**
 * The stylesheet as text, so the token the geometry rests on can be asserted
 * from a test jsdom is otherwise blind to.
 *
 * Read off disk rather than imported: `vitest.config.ts` sets `css: false`,
 * which stubs every CSS import — `?raw` included — to an empty string, so
 * `import indexCss from '@/index.css?raw'` handed this test `''` and the
 * `toContain` below could not fail no matter what the token said.
 *
 * Resolved from the Vitest root (the directory holding `vitest.config.ts`, so
 * `frontend`) because `import.meta.url` here is the dev server's own URL, not a
 * `file:` one — `fileURLToPath` rejects it.
 */
const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

/**
 * The declarations of the first rule whose selector list is exactly
 * `selector`, so a token can be checked against the rule that uses it rather
 * than against the file at large. `index.css` is CRLF on disk, hence the
 * normalisation — a multi-line selector list will not match otherwise.
 */
const ruleBody = (selector: string): string => {
  const css = indexCss.replace(/\r\n/g, '\n')
  const at = css.indexOf(`${selector} {`)
  expect(at, `\`${selector} {\` is not in index.css`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}

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
  onUndo: vi.fn(),
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

  it('undoes from the keyboard, and leaves the browser its own chords', async () => {
    const onUndo = vi.fn()
    const onSetCell = vi.fn()
    render(<TimesheetGrid {...props} onUndo={onUndo} onSetCell={onSetCell} />)
    cell('G1001', 5).focus()
    // UI spec §8's keyboard model ends with Ctrl+Z; `undo` was reachable only
    // through the ribbon button, so a keyboard operator had to leave the sheet.
    await userEvent.keyboard('{Control>}z{/Control}')
    expect(onUndo).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{Meta>}z{/Meta}')
    expect(onUndo).toHaveBeenCalledTimes(2)
    // Ctrl+Shift+Z is REDO on both platforms, and this feature has none: `undo`
    // only pops the correction stack and issues another live non-quiet write, so
    // answering redo would reverse a second correction with no way forward and
    // compound on every further press. The letter guards below leave `shiftKey`
    // alone because they match case-insensitively; `z` has no counterpart.
    await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    await userEvent.keyboard('{Meta>}{Shift>}z{/Shift}{/Meta}')
    expect(onUndo).toHaveBeenCalledTimes(2)
    // And a code letter under a modifier is the BROWSER's command, not a paint:
    // `s` is sick leave, so Ctrl+S marked sick leave and swallowed the save.
    // `a`, `p` and `x` did the same to select-all, print and cut.
    await userEvent.keyboard('{Control>}s{/Control}')
    await userEvent.keyboard('{Control>}a{/Control}')
    await userEvent.keyboard('{Control>}p{/Control}')
    await userEvent.keyboard('{Control>}x{/Control}')
    expect(onSetCell).not.toHaveBeenCalled()
    // The letter alone still paints.
    await userEvent.keyboard('s')
    expect(onSetCell).toHaveBeenCalledWith('G1001', 5, 'SL ')
  })

  it('undoes from the row handle too, not only from a cell', async () => {
    const onUndo = vi.fn()
    render(<TimesheetGrid {...props} onUndo={onUndo} />)
    // The row handle is a focusable button in the grid that is not a `.ts-cell`
    // — it is what points the dock's panels and the two-month extract at one
    // employee (§16.2, §16.3) — so scoping the chord to a cell made Ctrl+Z a
    // silent no-op right after the select gesture. The scope is DOM containment
    // in the grid, which is also what keeps the portalled popover out: a fiber
    // descendant of this root, but not a DOM one.
    screen.getByRole('button', { name: /select G1001/i }).focus()
    await userEvent.keyboard('{Control>}z{/Control}')
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('treats a modifier click as the browser\'s, and keeps shift-click as the range', async () => {
    const onSetCell = vi.fn()
    const onFill = vi.fn()
    const user = userEvent.setup()
    render(<TimesheetGrid {...props} brush="AL" onSetCell={onSetCell} onFill={onFill} />)
    // This is the paint path a keydown guard cannot reach: a day cell is a real
    // `<button>` and its native activation is not modifier-gated. Measured in
    // Chromium, `Ctrl+Space` on a focused cell dispatches a synthesized click
    // that PAINTED the armed brush, where bare Space opens the picker — a
    // silent write in place of a menu. The synthesized click carries the
    // modifier state, so the guard lives on the click, and a real Ctrl+click
    // exercises the same line. (`Ctrl+Enter` does not synthesize one: Chromium
    // gates the Enter activation on modifiers and the Space activation not.)
    await user.keyboard('{Control>}')
    await user.click(cell('G1001', 3))
    await user.keyboard('{/Control}')
    expect(onSetCell).not.toHaveBeenCalled()
    // Shift stays out of the guard: it is §8's range gesture.
    await user.click(cell('G1001', 3))
    expect(onSetCell).toHaveBeenCalledWith('G1001', 3, 'AL')
    await user.keyboard('{Shift>}')
    await user.click(cell('G1001', 6))
    await user.keyboard('{/Shift}')
    expect(onFill).toHaveBeenCalledWith(
      [at('G1001', 3), at('G1001', 4), at('G1001', 5), at('G1001', 6)],
      'AL',
    )
  })

  it('does not undo from the keyboard on a sealed month', async () => {
    const onUndo = vi.fn()
    render(<TimesheetGrid {...props} closed onUndo={onUndo} />)
    cell('G1001', 5).focus()
    await userEvent.keyboard('{Control>}z{/Control}')
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('leaves the browser its chords inside the picker too', async () => {
    const onSetCell = vi.fn()
    render(<TimesheetGrid {...props} onSetCell={onSetCell} />)
    await userEvent.click(cell('G1001', 5))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    // The paint path has THREE handlers, not two: the grid's guard returns
    // without `stopPropagation`, so every chord it declines arrives here and
    // `choose()` runs straight through to `onSetCell`. The picker is what a
    // no-brush click opens, so this is the primary correction surface — and it
    // is the whole code table: Ctrl+B diverts to the note step, Ctrl+T writes
    // TR while a tab opens, Ctrl+N writes NG while a window opens, and
    // Ctrl+minus writes the roster-edge dash while the page zooms.
    for (const chord of ['s', 'a', 'p', 'x', 'b', 't', 'n', '-']) {
      await userEvent.keyboard(`{Control>}${chord}{/Control}`)
    }
    await userEvent.keyboard('{Meta>}s{/Meta}')
    await userEvent.keyboard('{Alt>}s{/Alt}')
    expect(onSetCell).not.toHaveBeenCalled()
    // Still a menu: Ctrl+B must not have diverted it to the note step either.
    expect(screen.getByRole('menu')).toBeInTheDocument()
    // The bare letter still picks. Shift stays out of the guard on purpose —
    // the letters are matched case-insensitively, so Shift+S and Caps Lock have
    // to keep working, and §8's range selection is shift-CLICK, a pointer
    // gesture that never reaches a key handler.
    await userEvent.keyboard('{Shift>}s{/Shift}')
    expect(onSetCell).toHaveBeenCalledWith('G1001', 5, 'SL ')
  })

  it('does not undo from inside the picker, where the chord is the field\'s own', async () => {
    const onUndo = vi.fn()
    render(<TimesheetGrid {...props} onUndo={onUndo} />)
    await userEvent.click(cell('G1001', 5))
    await userEvent.click(screen.getByRole('menuitem', { name: /absence/i }))
    const field = screen.getByRole('textbox', { name: /note/i })
    await userEvent.type(field, 'no show')
    // React dispatches portal events along the FIBER tree, not the DOM tree, so
    // the grid root's capture handler is on the path for keystrokes inside the
    // popover — the portal is not a boundary. Unscoped, Ctrl+Z in this field
    // reversed the previous correction with a live non-quiet write instead of
    // undoing the typed text.
    await userEvent.keyboard('{Control>}z{/Control}')
    // AltGr is reported as Ctrl+Alt on Windows, and this is a bilingual product
    // where AltGr is in daily use.
    await userEvent.keyboard('{Control>}{Alt>}z{/Alt}{/Control}')
    expect(onUndo).not.toHaveBeenCalled()
    // jsdom implements no native undo, so the text surviving is not observable
    // here; what is, is that the sheet did not answer the keystroke.
    expect(field).toHaveValue('no show')
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
    // Placed and revealed in one layout pass: the box mounts at `opacity-0` and
    // the SAME imperative write that positions it makes it visible, so it can
    // never be painted at the wrong place — and a React-owned `style` prop
    // added here later, which would clobber the reveal and leave the counts
    // permanently invisible, fails right here.
    expect(tally.className).toContain('opacity-0')
    expect(tally.style.transform).toMatch(/^translate3d\(/)
    expect(tally.style.opacity).toBe('1')
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

    // Scoped to the header row: the group headings and the headcount label are
    // `columnheader`s too, and they sit after the day columns in document order.
    const headers = within(screen.getAllByRole('row')[0]).getAllByRole('columnheader')
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
    const css = indexCss
    const sum = ID_COLUMNS.map((token) => `var(${token})`).join(' + ')
    expect(css).toContain(`--id-block: calc(${sum});`)
  })

  it('keeps the row pitch and its own hairline inside one declaration', () => {
    // What this proves, and what it does not. jsdom has no layout and does not
    // load the stylesheet, so it CANNOT be asked whether a row measures 28px —
    // it would agree with a wrong number just as happily, which is how the
    // defect below survived every other test in this file. What it can pin is
    // the arithmetic a browser then resolves: `--row` is the PITCH, the cell's
    // bottom rule is `--ts-rule` wide, and the cell is the pitch MINUS that
    // rule — so a row's border box is exactly `var(--row)`, which is also what
    // the loading skeleton's rows declare (`blockSize: 'var(--row)'` in
    // `TimesheetPage.tsx`, pinned by `TimesheetPage.test.tsx`). One declaration,
    // two consumers, like `--id-block` across the other axis.
    //
    // The defect: shipped as `block-size: var(--row)` with a 1px
    // `border-block-end` under `border-collapse: separate`, the row measured
    // 29px against a 28px skeleton row — 24px of drift over the skeleton's rows
    // and 275px on a full roster. Measured in Chromium at 1600x900, before and
    // after: grid pitch 29 -> 28, skeleton pitch 28 -> 28.
    expect(indexCss).toContain('--ts-rule: 1px;')
    // Without the token the `calc()` is invalid at computed-value time and the
    // cell silently falls back to `auto`, i.e. its line box.
    expect(ruleBody('.ts-cell')).toContain('block-size: calc(var(--row) - var(--ts-rule));')
    const cells = ruleBody('.ts-sheet th,\n.ts-sheet td')
    expect(cells).toContain('border-block-end: var(--ts-rule) solid var(--hairline);')
    // Padding sits outside the subtraction and would put the drift straight back.
    expect(cells).toContain('padding: 0;')
  })

  it('takes the header and footer bands from tokens the skeleton can read', () => {
    render(<TimesheetGrid {...props} />)
    // The loading skeleton holds the header band open at `var(--ts-head)`
    // (`TimesheetPage.tsx`, pinned by `TimesheetPage.test.tsx`), so the band's
    // height has to live in exactly one place. It did not: the cells said 34px
    // and both the header and the footer ROW re-declared `block-size:
    // var(--row)`, which a row cannot be shorter than — so measured in Chromium
    // the header was 34/34/38 and the footer 26/28/38 across
    // compact/default/roomy. A token cannot describe three heights, and a
    // derived one cannot help: `var()` inside a custom property is substituted
    // where it is DECLARED, so `max(34px, var(--row))` on `:root` would freeze
    // `--row` at 28px and be wrong at both other stops.
    //
    // Both bands are fixed instead, which matches their type — the day number
    // is 11px, its weekday letter 8.5px and the headcount 10.5px at every stop,
    // none of them `var(--cell-font)`. So the rows declare nothing and the
    // cells carry the token. Measured after: header 34 and footer 26 at all
    // three stops, skeleton band 34, first body line at the same 34px offset in
    // both layouts.
    expect(indexCss).toContain('--ts-head: 34px;')
    expect(indexCss).toContain('--ts-foot: 26px;')
    expect(ruleBody('.ts-sheet thead th')).toContain('block-size: var(--ts-head);')
    expect(ruleBody('.ts-sheet tfoot th,\n.ts-sheet tfoot td')).toContain(
      'block-size: var(--ts-foot);',
    )
    // Nothing may re-declare a competing height on the rows themselves, or the
    // token stops being the number the band actually measures.
    const table = screen.getByRole('table') as HTMLTableElement
    expect(table.tHead?.rows[0].style.blockSize).toBe('')
    expect(table.tFoot?.rows[0].style.blockSize).toBe('')
    // The data rows still declare the pitch — that one is the contract.
    for (const tr of screen.getAllByTestId('timesheet-row')) {
      expect(tr.style.blockSize).toBe('var(--row)')
    }
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

  it('flags the sweep where the stylesheet looks for it', () => {
    render(<TimesheetGrid {...props} brush="AL" />)
    fireEvent.pointerDown(cell('G1001', 3), {
      button: 0,
      buttons: 1,
      pointerId: 1,
      isPrimary: true,
      pointerType: 'mouse',
    })
    fireEvent.pointerOver(cell('G1001', 5), { pointerId: 1, pointerType: 'mouse' })
    const sheet = screen.getByRole('table')
    // The component holds ONE ref — the wrapper `<div>` that carries the
    // capture-phase handlers — so `data-dragging` lands on an ancestor of the
    // table and never on the table itself.
    expect(sheet.hasAttribute('data-dragging')).toBe(false)
    expect(sheet.closest('[data-dragging="1"]')).not.toBeNull()
    // So the rule that suppresses the row tint mid-sweep has to key the
    // ancestor. Written `.ts-sheet[data-dragging='1']` it matched nothing, and
    // a sweep tinted every row it crossed: measured in Chromium mid-sweep, the
    // crossed row's identity cells resolved `--surface-tinted` (#f0eee8) —
    // indistinguishable from a plain hover. jsdom loads no stylesheet, so this
    // pins the two halves to each other, not the resolved colour.
    expect(indexCss).toContain(
      "[data-dragging='1'] .ts-sheet tbody tr:hover .ts-stick { background: var(--surface); }",
    )
    // The preview marks EXACTLY the swept cells. `preview` no longer asks the
    // DOM for each one — a `querySelector` per cell per pointer step was the
    // last O(cells) cost in the inner loop — and reads
    // `tr.cells[5 + day - 1].firstElementChild` instead, so an off-by-one in
    // that arithmetic would ring the wrong column while `onFill` still reported
    // the right days.
    expect(
      Array.from(sheet.querySelectorAll('.ts-cell[data-preview="1"]')).map(
        (node) => node.getAttribute('data-day'),
      ),
    ).toEqual(['3', '4', '5'])
    window.dispatchEvent(new Event('pointerup'))
    expect(sheet.closest('[data-dragging="1"]')).toBeNull()
  })

  it('cancels the sweep on pointercancel without filling anything', () => {
    const onFill = vi.fn()
    render(<TimesheetGrid {...props} brush="AL" onFill={onFill} />)
    fireEvent.pointerDown(cell('G1001', 3), {
      button: 0,
      buttons: 1,
      pointerId: 1,
      isPrimary: true,
      pointerType: 'mouse',
    })
    fireEvent.pointerOver(cell('G1001', 8), { pointerId: 1, pointerType: 'mouse' })
    expect(screen.getByRole('table').closest('[data-dragging="1"]')).not.toBeNull()

    window.dispatchEvent(new Event('pointercancel'))
    expect(screen.getByRole('table').closest('[data-dragging="1"]')).toBeNull()
    window.dispatchEvent(new Event('pointerup'))
    expect(onFill).not.toHaveBeenCalled()
  })

  it('removes the sweep listeners when the grid unmounts', () => {
    const onFill = vi.fn()
    const { unmount } = render(<TimesheetGrid {...props} brush="AL" onFill={onFill} />)
    fireEvent.pointerDown(cell('G1001', 3), {
      button: 0,
      buttons: 1,
      pointerId: 1,
      isPrimary: true,
      pointerType: 'mouse',
    })
    fireEvent.pointerOver(cell('G1001', 8), { pointerId: 1, pointerType: 'mouse' })
    unmount()

    window.dispatchEvent(new Event('pointerup'))
    expect(onFill).not.toHaveBeenCalled()
  })

  it('cancels the sweep on Escape without filling anything', async () => {
    const onFill = vi.fn()
    // One instance across the press, the Escape and the release. Strengthened
    // under the standing precedent: with the direct API the release lands on a
    // fresh instance that has nothing pressed, dispatches no `pointerup`, and
    // `onFill` then goes uncalled whether Escape cancelled the sweep or not —
    // an assertion that could not fail. Held on one instance the release is
    // real, so this now proves what it says: Escape ended the sweep, and the
    // `pointerup` that follows it commits nothing.
    const user = userEvent.setup()
    render(<TimesheetGrid {...props} brush="AL" onFill={onFill} />)
    await user.pointer([
      { keys: '[MouseLeft>]', target: cell('G1001', 3) },
      { target: cell('G1001', 8) },
    ])
    await user.keyboard('{Escape}')
    await user.pointer([{ keys: '[/MouseLeft]' }])
    expect(onFill).not.toHaveBeenCalled()
    expect(screen.getByRole('table').closest('[data-dragging="1"]')).toBeNull()
  })


  it('does not eat the next click when the sweep is released outside the grid', async () => {
    const onFill = vi.fn()
    const user = userEvent.setup()
    // No brush: the sweep spreads the anchor's own code, and the click that
    // follows opens the picker rather than painting — which is the affordance
    // the leaked flag swallowed.
    render(<TimesheetGrid {...props} onFill={onFill} />)
    // Released off the sheet — what dragging toward row 1 out of the scroll
    // region, or past the table's trailing edge, actually does. Per UI Events a
    // `click` whose `pointerdown` and `pointerup` have different targets is
    // dispatched at their nearest common inclusive ancestor, which is then
    // OUTSIDE this component: the grid's own `onClickCapture` is not on the
    // path, so it cannot be the only place the swallow flag is cleared.
    await user.pointer([
      { keys: '[MouseLeft>]', target: cell('G1001', 3) },
      { target: cell('G1001', 6) },
      { keys: '[/MouseLeft]', target: document.body },
    ])
    expect(onFill).toHaveBeenCalledTimes(1)
    // The operator's very next click has to work. With the flag left armed it
    // was consumed in silence — no picker, no paint, no selection, nothing
    // said — and the click after that worked, so it read as a dropped input.
    await user.click(cell('G1001', 9))
    expect(await screen.findByRole('menu')).toBeInTheDocument()
  })

  it('shift-clicks the inclusive run from the last painted day', async () => {
    const onFill = vi.fn()
    const onSetCell = vi.fn()
    // `userEvent.setup()`, not the direct API: held keys are per-instance, and
    // the direct API builds a fresh one per call and releases what it pressed
    // when the call ends. `userEvent.keyboard('{Shift>}')` followed by
    // `userEvent.click(...)` therefore clicks with `shiftKey: false`, and this
    // assertion could never pass however the component behaved.
    const user = userEvent.setup()
    render(<TimesheetGrid {...props} brush="AL" onFill={onFill} onSetCell={onSetCell} />)
    await user.click(cell('G1001', 6))
    expect(onSetCell).toHaveBeenCalledWith('G1001', 6, 'AL')
    await user.keyboard('{Shift>}')
    await user.click(cell('G1001', 9))
    await user.keyboard('{/Shift}')
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

  it('shows a note on the day it belongs to and not on its neighbour', () => {
    // `GridRow.notes` is `dict[int, str]` on the server and therefore STRING
    // keys on the wire, so the cell reads `notes[String(day)]`. What this pins
    // is the note landing on the day it owns and off the next one, and it is
    // the only assertion in this file that touches a cell's `title` at all — so
    // it catches a dropped `title` prop or an off-by-one.
    //
    // It does NOT catch a switch to `notes[day]`, and the round-3 comment that
    // claimed it did was wrong: a JavaScript property key is always a string,
    // so `notes[14]` and `notes['14']` are one lookup at runtime. There is no
    // guard there to trust.
    render(<TimesheetGrid {...props} rows={[{ ...row, notes: { '14': 'called in' } }]} />)
    expect(cell('G1001', 14)).toHaveAttribute('title', 'called in')
    expect(cell('G1001', 15)).not.toHaveAttribute('title')
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
    // `Day 2: 1`, not `Row 2: 1`. `timesheet.colRow` is the `#` serial
    // column's own name — `"Row"` / `"م"` — and borrowing it here named the
    // wrong axis in the operator's own language.
    expect(footer[1]).toHaveAttribute('title', 'Day 2: 1')
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

  it('keeps the drag tag and printed form order LTR under RTL', () => {
    const previousDir = document.documentElement.dir
    document.documentElement.dir = 'rtl'
    try {
      render(
        <>
          <TimesheetMasthead year={2026} month={7} />
          <TimesheetGrid {...props} brush="AL" />
        </>,
      )
      expect(screen.getByTestId('timesheet-masthead-form')).toHaveAttribute('dir', 'ltr')
      const tag = document.querySelector('.ts-dragtag') as HTMLDivElement
      expect(tag).toHaveAttribute('dir', 'ltr')
      Object.defineProperty(tag, 'offsetWidth', { configurable: true, value: 40 })

      fireEvent.pointerDown(cell('G1001', 3), {
        button: 0,
        buttons: 1,
        pointerId: 1,
        isPrimary: true,
        pointerType: 'mouse',
      })
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 50 }))
      expect(tag.style.transform).toBe(
        `translate3d(${100 + 14 - (window.innerWidth - 40)}px, 64px, 0)`,
      )
      window.dispatchEvent(new Event('pointerup'))
    } finally {
      document.documentElement.dir = previousDir
    }
  })
})

describe('TimesheetMasthead', () => {
  it('quotes the printed workbook header, month and all', () => {
    render(<TimesheetMasthead year={2026} month={7} />)
    expect(screen.getByText(/as it prints/i)).toBeInTheDocument()
    const quote = screen.getByTestId('timesheet-masthead-quote')
    // `textContent`, not `toHaveTextContent`: the matcher normalises runs of
    // whitespace, and the double spaces are the template's own.
    expect(quote.textContent).toContain('Global Security Service Group- MONTHLY  TIME SHEET')
    expect(quote.textContent).toContain('Site Name :   JD 908')
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
