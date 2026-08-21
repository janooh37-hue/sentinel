/**
 * The dock — fixed furniture below the grid, four groups, one panel host
 * (UI spec §16.2).
 *
 * The dock owns `panel` only through `ui.panel` and `onOpenPanel`, so a toggle
 * is driven the way `TimesheetPage` drives it: re-render with the new `ui`.
 */
// `vitest.config.ts` sets `css: false`, which stubs every CSS import — `?raw`
// included — to an empty string, so the stylesheet is read off disk instead.
// The established pattern in `TimesheetGrid.test.tsx:17`.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { TimesheetGridResponse, TimesheetRow } from '@/lib/api'

import { TimesheetDock, type TimesheetDockProps } from './TimesheetDock'

function renderPanel(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const ROW: TimesheetRow = {
  employee_id: 'G7057',
  row_no: 1,
  name_en: 'RAJESH KUMAR SINGH',
  nationality_en: 'U.A.E',
  designation_en: 'SECURITY GUARD',
  designation_ar: 'حارس أمن',
  rank_order: 1,
  codes: [...Array<string>(29).fill('P'), 'AL', 'AL'],
  stat_codes: Array<string>(31).fill('P'),
  stat_block: 1,
  stat_filler: null,
  joined_day: null,
  left_day: null,
  start_confirmed: false,
  notes: {},
}

/**
 * A complete payload, so a missing field is a type error rather than a silent
 * `undefined` in a panel. The `MonthGrid` shape from Task 3 exactly: `blocking`
 * and `warnings` sit at the top level (there is no `preflight` wrapper), each
 * item is `{ employee_id, kind, detail }`, and "closed" is `closed_at !== null`
 * — there is no boolean `closed` field on the wire.
 */
function dockProps({
  blocking = 0,
  closed = false,
  canEdit = true,
  rows = [],
  onReopen = vi.fn(),
}: {
  blocking?: number
  closed?: boolean
  canEdit?: boolean
  rows?: TimesheetRow[]
  onReopen?: () => void
}): TimesheetDockProps {
  const grid: TimesheetGridResponse = {
    year: 2026,
    month: 7,
    days_in_month: 31,
    sheet: 'main',
    closed_at: closed ? '2026-08-01T06:00:00' : null,
    closed_by: closed ? 'A. Al Mansoori' : null,
    post_count: 249,
    rows,
    blocking: Array.from({ length: blocking }, (_, i) => ({
      employee_id: `G70${i}`,
      kind: 'no_designation',
      detail: `G70${i} NO DESIGNATION`,
    })),
    warnings: [],
    removed: [],
  }
  return {
    grid,
    canEdit,
    joined: [],
    leaving: [],
    ui: {
      variant: 'attendance',
      brush: null,
      selected: null,
      panel: null,
      query: '',
      density: 'default',
    },
    onOpenPanel: vi.fn(),
    onSelect: vi.fn(),
    onQuery: vi.fn(),
    onAcknowledge: vi.fn(),
    onSetPostCount: vi.fn(),
    onDownload: vi.fn(),
    onEmployeeDownload: vi.fn(),
    onFillRedBlock: vi.fn(),
    onClose: vi.fn(),
    onReopen,
  }
}

describe('TimesheetDock', () => {
  it('disables both downloads while a blocking check is open and says why', async () => {
    renderPanel(<TimesheetDock {...dockProps({ blocking: 2 })} />)
    expect(await screen.findByRole('button', { name: /attendance/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /client statistics/i })).toBeDisabled()
    // UI spec §11's binding English string is "Fix before download" (:386).
    expect(screen.getByText(/fix before download/i)).toBeInTheDocument()
  })

  it('enables the downloads when the checks are clear', async () => {
    renderPanel(<TimesheetDock {...dockProps({ blocking: 0 })} />)
    expect(await screen.findByRole('button', { name: /attendance/i })).toBeEnabled()
  })

  it('asks the page to open a panel, and marks the trigger expanded when it is', async () => {
    const base = dockProps({ blocking: 0 })
    const onOpenPanel = vi.fn()
    const { rerender } = renderPanel(<TimesheetDock {...base} onOpenPanel={onOpenPanel} />)
    const trigger = await screen.findByRole('button', { name: /codes/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    expect(onOpenPanel).toHaveBeenCalledWith('codes')

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TimesheetDock {...base} ui={{ ...base.ui, panel: 'codes' }} onOpenPanel={onOpenPanel} />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('button', { name: /codes/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('region', { name: /cells by code/i })).toBeInTheDocument()
  })

  it('closes the open panel on Escape', async () => {
    const base = dockProps({ blocking: 0 })
    const onOpenPanel = vi.fn()
    renderPanel(
      <TimesheetDock {...base} ui={{ ...base.ui, panel: 'codes' }} onOpenPanel={onOpenPanel} />,
    )
    await userEvent.keyboard('{Escape}')
    expect(onOpenPanel).toHaveBeenCalledWith(null)
  })

  it('needs two steps to reopen a closed month', async () => {
    const onReopen = vi.fn()
    const base = dockProps({ blocking: 0, closed: true, onReopen })
    renderPanel(<TimesheetDock {...base} ui={{ ...base.ui, panel: 'release' }} />)
    await userEvent.click(await screen.findByRole('button', { name: /reopen month/i }))
    expect(onReopen).not.toHaveBeenCalled()
    expect(screen.getByText(/supersede/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^reopen$/i }))
    expect(onReopen).toHaveBeenCalled()
  })

  it('takes the reopen back on cancel', async () => {
    const onReopen = vi.fn()
    const base = dockProps({ blocking: 0, closed: true, onReopen })
    renderPanel(<TimesheetDock {...base} ui={{ ...base.ui, panel: 'release' }} />)
    await userEvent.click(await screen.findByRole('button', { name: /reopen month/i }))
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onReopen).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /reopen month/i })).toBeInTheDocument()
  })

  /**
   * Four groups, ONE host: a panel that stayed behind when another opened would
   * cover the grid twice and put two `Escape` targets on the page.
   */
  it('keeps one panel open at a time in one host', async () => {
    const base = dockProps({ blocking: 0 })
    const { rerender } = renderPanel(
      <TimesheetDock {...base} ui={{ ...base.ui, panel: 'codes' }} />,
    )
    expect(await screen.findByRole('region', { name: /cells by code/i })).toBeInTheDocument()
    expect(screen.getAllByRole('region')).toHaveLength(1)
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TimesheetDock {...base} ui={{ ...base.ui, panel: 'posts' }} />
      </QueryClientProvider>,
    )
    expect(screen.getAllByRole('region')).toHaveLength(1)
    expect(screen.getByRole('region', { name: /contracted posts/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /cells by code/i })).not.toBeInTheDocument()
  })

  /**
   * The panel opens UPWARD over the grid and is taken out of flow, so opening
   * one costs no layout shift and cannot make the page scroll. jsdom has no
   * layout, so the only honest assertion is on the declarations that produce it
   * — the class the stylesheet keys and the rule itself.
   */
  it('opens the panel upward, out of flow, from one declaration', async () => {
    const base = dockProps({ blocking: 0 })
    renderPanel(<TimesheetDock {...base} ui={{ ...base.ui, panel: 'codes' }} />)
    const panel = await screen.findByRole('region', { name: /cells by code/i })
    expect(panel.className).toContain('ts-panel')
    const host = panel.parentElement as HTMLElement
    expect(host.className).toContain('ts-panelhost')

    const rule = ruleBody('.ts-panel')
    expect(rule).toContain('position: absolute')
    // Anchored to the dock's block-start edge and grown upward, never `top`.
    expect(rule).toMatch(/inset-block-end:\s*100%/)
    expect(rule).toMatch(/max-block-size:\s*46vh/)
    // The host is the positioning context; without it the panel would resolve
    // against whatever ancestor happens to be positioned.
    expect(ruleBody('.ts-panelhost')).toContain('position: relative')
  })

  it('reads all eight code counts without opening anything', async () => {
    renderPanel(<TimesheetDock {...dockProps({ blocking: 0, rows: [ROW] })} />)
    const strip = await screen.findByTestId('dock-codes')
    expect(within(strip).getByTestId('dock-count-P')).toHaveTextContent('29')
    expect(within(strip).getByTestId('dock-count-AL')).toHaveTextContent('2')
    expect(within(strip).getByTestId('dock-count-X')).toHaveTextContent('0')
    expect(strip.querySelectorAll('[data-testid^="dock-count-"]')).toHaveLength(8)
  })

  it('contracts and implies the posts at a glance', async () => {
    renderPanel(<TimesheetDock {...dockProps({ blocking: 0, rows: [ROW] })} />)
    // 29 P cells over 31 days = 0.9 implied posts against a contract of 249.
    const posts = await screen.findByRole('button', { name: /contracted posts/i })
    expect(posts).toHaveTextContent('249')
    expect(posts).toHaveTextContent('0.9')
  })

  it('seals a closed month in the dock and in the panel', async () => {
    const base = dockProps({ blocking: 0, closed: true })
    renderPanel(<TimesheetDock {...base} ui={{ ...base.ui, panel: 'release' }} />)
    expect(await screen.findAllByText(/closed/i)).not.toHaveLength(0)
    expect(screen.getByText(/A\. Al Mansoori/)).toBeInTheDocument()
  })

  it('states that the download freezes the month', async () => {
    const base = dockProps({ blocking: 0 })
    renderPanel(<TimesheetDock {...base} ui={{ ...base.ui, panel: 'release' }} />)
    expect(
      await screen.findByText(/the first download closes the month and freezes this grid/i),
    ).toBeInTheDocument()
  })

  it('prints both workbook names', async () => {
    const base = dockProps({ blocking: 0 })
    renderPanel(<TimesheetDock {...base} ui={{ ...base.ui, panel: 'release' }} />)
    const files = await screen.findByTestId('release-files')
    // The deliverables' own names, identical in both UI languages, so they are
    // not interface copy. A quoted filename needs `direction: ltr` AND isolate,
    // or `.xlsx` jumps to the wrong end (UI spec §14).
    for (const name of Array.from(files.children) as HTMLElement[]) {
      expect(name.getAttribute('dir')).toBe('ltr')
      expect(name.className).toContain('[unicode-bidi:isolate]')
      expect(name.textContent).toMatch(/\.xlsx$/)
    }
    expect(files.children).toHaveLength(2)
  })

  // Amendment A3: `timesheet.view` alone must still be a USABLE dock — the
  // panels that only read stay usable, and every writing affordance is absent
  // rather than disabled (a disabled control still answers Enter and Space).
  it('hands a read-only operator the reading panels and no writing affordance', async () => {
    const base = dockProps({ blocking: 0, canEdit: false, rows: [ROW] })
    const { rerender } = renderPanel(
      <TimesheetDock {...base} ui={{ ...base.ui, panel: 'posts' }} />,
    )
    // Posts: the readout and the rule are still there; the field is not.
    expect(await screen.findByRole('region', { name: /contracted posts/i })).toBeInTheDocument()
    expect(screen.getByTestId('implied-posts')).toHaveTextContent('0.9')
    expect(screen.queryByLabelText(/contracted posts/i)).not.toBeInTheDocument()

    // The month download FREEZES the month, so it needs `timesheet.edit`.
    expect(screen.queryByRole('button', { name: /attendance/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /client statistics/i })).not.toBeInTheDocument()

    // Codes read for anybody.
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TimesheetDock {...base} ui={{ ...base.ui, panel: 'codes' }} />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('region', { name: /cells by code/i })).toBeInTheDocument()

    // Release: the names and the reason, no close and no reopen.
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TimesheetDock {...base} ui={{ ...base.ui, panel: 'release' }} />
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('release-files').children).toHaveLength(2)
    expect(screen.getByText(/reading only/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reopen/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /close the month/i })).not.toBeInTheDocument()
  })

  it('lets an editor seal the month without producing a file', async () => {
    const onClose = vi.fn()
    const base = dockProps({ blocking: 0 })
    renderPanel(
      <TimesheetDock {...base} ui={{ ...base.ui, panel: 'release' }} onClose={onClose} />,
    )
    await userEvent.click(await screen.findByRole('button', { name: /close the month/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('writes the post count once the field is committed', async () => {
    const onSetPostCount = vi.fn()
    const base = dockProps({ blocking: 0, rows: [ROW] })
    renderPanel(
      <TimesheetDock
        {...base}
        ui={{ ...base.ui, panel: 'posts' }}
        onSetPostCount={onSetPostCount}
      />,
    )
    const field = await screen.findByLabelText(/contracted posts/i)
    await userEvent.clear(field)
    await userEvent.type(field, '24')
    await userEvent.tab()
    expect(onSetPostCount).toHaveBeenCalledWith(24)
  })

  it('refuses the post count on a closed month without a dead control', async () => {
    const base = dockProps({ blocking: 0, closed: true, rows: [ROW] })
    renderPanel(<TimesheetDock {...base} ui={{ ...base.ui, panel: 'posts' }} />)
    expect(await screen.findByTestId('implied-posts')).toHaveTextContent('0.9')
    expect(screen.queryByLabelText(/contracted posts/i)).not.toBeInTheDocument()
    expect(screen.getByText(/this month is closed/i)).toBeInTheDocument()
  })
})

/**
 * The declarations of the first rule whose selector list is exactly `selector`,
 * so a declaration is checked against the rule that owns it rather than against
 * the file at large. `index.css` is CRLF on disk, hence the normalisation.
 */
const ruleBody = (selector: string): string => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(
    /\r\n/g,
    '\n',
  )
  const at = css.indexOf(`${selector} {`)
  expect(at, `\`${selector} {\` is not in index.css`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}
