/**
 * The side glance — the 210px margin column beside the sheet (design §"Side
 * glance").
 *
 * It holds nothing. `TimesheetPage` owns the active view, the collapsed flag,
 * the code index and the filter; this column prints what it is handed and
 * reports intentions back. So the cases below are about the two views, the
 * rail, and standing down for the bottom dock — never about state.
 *
 * The load-bearing facts pinned here: a code carries the workbook's own
 * `data-code` attribute and no palette of its own; a code nobody carries is
 * visible and refused rather than hidden; the checks scroll INSIDE the column;
 * the rail still answers the one number that blocks the download; and nothing
 * in the column is positioned physically, so the whole thing mirrors under
 * Arabic without a second rule.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'

import { TimesheetGlance, type TimesheetGlanceProps } from './TimesheetGlance'

/** Two codes carried, three cells of one of them, and one code nobody has. */
const INDEX = {
  cellCounts: { P: 27, AL: 3, SL: 0, AB: 1, TR: 0, NG: 0, '-': 0, X: 0 },
  employeeIds: {
    P: ['G7014', 'G7099'],
    AL: ['G7014'],
    SL: [],
    AB: ['G7099'],
    TR: [],
    NG: [],
    '-': [],
    X: [],
  },
}

function glanceProps(over: Partial<TimesheetGlanceProps> = {}): TimesheetGlanceProps {
  return {
    index: INDEX,
    activeCode: null,
    blocking: [
      { employee_id: 'G7099', kind: 'no_designation', detail: 'G7099 NAWAF AL BALUSHI' },
    ],
    warnings: [
      {
        employee_id: 'G6001',
        kind: 'departed_but_active',
        detail: 'OMAR SAEED finished on 2026-05-31 but is still Active.',
      },
    ],
    joined: [],
    leaving: [],
    removed: [],
    // G7099 has a row on this sheet; the warning's G6001 deliberately does not.
    rosterEmployeeIds: new Set(['G7014', 'G7099']),
    tab: 'codes',
    collapsed: false,
    dockOpen: false,
    year: 2026,
    month: 7,
    closed: false,
    canEdit: true,
    onTab: vi.fn(),
    onCollapse: vi.fn(),
    onFilterCode: vi.fn(),
    onShowRow: vi.fn(),
    onAcknowledge: vi.fn(),
    ...over,
  }
}

function renderGlance(over: Partial<TimesheetGlanceProps> = {}) {
  // The checks view links to the employee record, so the column needs a router.
  return render(
    <MemoryRouter>
      <TimesheetGlance {...glanceProps(over)} />
    </MemoryRouter>,
  )
}

/**
 * Every class token in the subtree, variant prefixes stripped — so `md:pl-2` is
 * judged as `pl-2`. A physical inset or margin is the one thing that does not
 * mirror, and it is invisible until an Arabic operator hits it.
 */
function tokensOf(root: HTMLElement): string[] {
  return [root, ...Array.from(root.querySelectorAll('*'))]
    .flatMap((node) => Array.from((node as HTMLElement).classList))
    .map((token) => token.slice(token.lastIndexOf(':') + 1))
}

describe('TimesheetGlance', () => {
  it('opens on cells by code, carrying the workbook’s own code attributes', async () => {
    renderGlance()
    const glance = await screen.findByTestId('timesheet-glance')

    // The badge is the workbook's conditional format, reached by attribute —
    // never a hex in this component (design §"Counts and colors").
    const badge = within(glance).getByTestId('code-badge-AL')
    expect(badge).toHaveAttribute('data-code', 'AL')
    expect(badge).toHaveTextContent('AL')
    expect(badge.className).not.toMatch(/#[0-9a-f]{3}/i)

    // Meaning and count in words, so the letter is never the only channel.
    expect(within(glance).getByRole('button', { name: /annual leave · 3 cells/i })).toBeEnabled()
    expect(within(glance).getByTestId('glance-count-AL')).toHaveTextContent('3')
    expect(within(glance).getAllByTestId(/^glance-code-/)).toHaveLength(8)
  })

  it('keeps a code nobody carries visible and refused', async () => {
    renderGlance()
    const sick = await screen.findByRole('button', { name: /sick leave/i })
    expect(sick).toBeVisible()
    expect(sick).toBeDisabled()
  })

  it('asks the page to filter by the code that was pressed', async () => {
    const onFilterCode = vi.fn()
    renderGlance({ onFilterCode })
    await userEvent.click(await screen.findByRole('button', { name: /annual leave/i }))
    expect(onFilterCode).toHaveBeenCalledWith('AL')
  })

  it('marks the code the sheet is already filtered by', async () => {
    renderGlance({ activeCode: 'AL' })
    expect(await screen.findByRole('button', { name: /annual leave/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /working day/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('badges the blocking count on the checks view and switches to it', async () => {
    const onTab = vi.fn()
    renderGlance({ onTab })
    const badge = await screen.findByTestId('glance-blocking')
    expect(badge).toHaveTextContent('1')
    // The numeral alone is decoration; the words ride along for a screen reader.
    expect(badge).toHaveTextContent(/to fix/i)

    await userEvent.click(screen.getByRole('button', { name: /^checks/i }))
    expect(onTab).toHaveBeenCalledWith('checks')
  })

  it('scrolls the checks inside the column, not the sheet', async () => {
    renderGlance({ tab: 'checks' })
    const body = await screen.findByTestId('glance-scroll')
    expect(body.className).toContain('overflow-y-auto')
    // A flex child only yields its intrinsic height when its min-size is
    // released; without this the column grows and the shell clips the findings.
    expect(body.className).toContain('min-h-0')
    expect(body).toContainElement(screen.getByText('G7099 NAWAF AL BALUSHI'))
  })

  it('hands a row jump to the page and keeps the profile link separate', async () => {
    const onShowRow = vi.fn()
    const onFilterCode = vi.fn()
    renderGlance({ tab: 'checks', onShowRow, onFilterCode })

    // The id of a man who HAS a row is the jump; the record link is its own
    // control, so neither gesture can fire the other.
    const jump = await screen.findByRole('button', { name: /G7099/ })
    expect(jump.closest('a')).toBeNull()
    await userEvent.click(jump)
    expect(onShowRow).toHaveBeenCalledWith('G7099')
    expect(onFilterCode).not.toHaveBeenCalled()

    const profile = screen
      .getAllByRole('link', { name: /open record/i })
      .map((link) => link.getAttribute('href'))
    expect(profile).toContain('/employees/G7099')
  })

  it('collapses to a rail that still answers what blocks the month', async () => {
    const onCollapse = vi.fn()
    renderGlance({ collapsed: true, onCollapse })
    const glance = await screen.findByTestId('timesheet-glance')

    // Nothing but the way back and the blocking count: at 36px there is no room
    // for a meaning, and that count is the one thing worth the pixels.
    expect(within(glance).queryByTestId('glance-code-AL')).not.toBeInTheDocument()
    expect(within(glance).getByTestId('glance-blocking')).toHaveTextContent('1')

    const toggle = within(glance).getByTestId('glance-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAccessibleName(/show the glance/i)
    await userEvent.click(toggle)
    expect(onCollapse).toHaveBeenCalledWith(false)
  })

  it('closes itself from the expanded header', async () => {
    const onCollapse = vi.fn()
    renderGlance({ onCollapse })
    const toggle = await screen.findByTestId('glance-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAccessibleName(/hide the glance/i)
    await userEvent.click(toggle)
    expect(onCollapse).toHaveBeenCalledWith(true)
  })

  /**
   * The bottom panel opens UPWARD over the sheet and would cover this column,
   * so the column stands down entirely: zero width in the page's grid, no
   * content, and out of the accessibility tree — a 210px strip of controls
   * behind an open panel is a tab stop into something the operator cannot see.
   */
  it('stands down while a bottom panel is open', async () => {
    renderGlance({ dockOpen: true })
    const glance = await screen.findByTestId('timesheet-glance')
    expect(glance).toHaveAttribute('aria-hidden', 'true')
    expect(glance).toHaveAttribute('inert')
    expect(within(glance).queryByTestId('glance-toggle')).not.toBeInTheDocument()
    expect(within(glance).queryByTestId('glance-code-AL')).not.toBeInTheDocument()
  })

  it('mirrors whole: nothing in the column is positioned physically', async () => {
    renderGlance()
    const glance = await screen.findByTestId('timesheet-glance')
    const physical = tokensOf(glance).filter((token) =>
      /^(?:m[lr]|p[lr]|border-[lr]|rounded-[lr]|left|right|text-(?:left|right))-/.test(token),
    )
    expect(physical).toEqual([])
  })

  describe('under ar', () => {
    beforeAll(async () => {
      await i18n.changeLanguage('ar')
    })
    afterAll(async () => {
      await i18n.changeLanguage('en')
    })

    it('reads in Arabic, and mirrors its chevron with a logical variant', async () => {
      renderGlance()
      const glance = await screen.findByTestId('timesheet-glance')
      const annual = i18n.t('timesheet.codes.annual')
      expect(within(glance).getByRole('button', { name: new RegExp(annual) })).toBeInTheDocument()
      expect(
        within(glance).queryByRole('button', { name: /annual leave/i }),
      ).not.toBeInTheDocument()
      // One declaration, both directions: the arrow points at the sheet either
      // way (UI spec §14's mirrored affordances).
      expect(within(glance).getByTestId('glance-toggle').innerHTML).toContain('rtl:rotate-180')
    })
  })
})
