/**
 * The filter navigation bar: the strip that opens inside the sheet card once a
 * code is filtering the roster (design §"Cells by code and filter navigation").
 *
 * Presentational, deliberately. `TimesheetPage` owns `{ code, index }` and the
 * scrolling; this bar is handed the resolved numbers and reports three
 * intentions back. So every case here is "given these numbers, what does the
 * operator see, and what does pressing a control report".
 *
 * Behaviours pinned here:
 *   1. The code is named twice — its glyph through the sheet's own `data-code`
 *      token, and its meaning in words — so the filter survives greyscale.
 *   2. Both totals are stated: employees to walk, and cells matched.
 *   3. The parked employee is named by id and name, and the position prints
 *      1-based against the employee total.
 *   4. Previous, Next and Clear are real buttons, named for what they move,
 *      and operable from the keyboard alone.
 *   5. Under `ar` every label is Arabic with no English beside it, and the
 *      Latin employee id stays bidi-isolated inside the Arabic strip.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Both bundles, because the Arabic cases assert the Arabic copy itself: the
// global test setup registers English only.
import i18n from '@/lib/i18n'

import { TimesheetCodeFilterBar } from './TimesheetCodeFilterBar'

/** Four guards carry AL across five days — the plan's own filter fixture. */
const props = {
  code: 'AL',
  cellCount: 5,
  employeeCount: 4,
  position: 1,
  employeeId: 'G7014',
  employeeName: 'MOHAMMED ASLAM',
  onPrevious: vi.fn(),
  onNext: vi.fn(),
  onClear: vi.fn(),
} as const

const FILTER_EMPLOYEES = [
  ['G7014', 'MOHAMMED ASLAM'],
  ['G7068', 'RAJESH KUMAR'],
  ['G7091', 'SURESH DAS'],
  ['G7120', 'OMAR HASSAN'],
] as const

function NavigationHarness(): React.JSX.Element {
  const [index, setIndex] = useState(0)
  const [active, setActive] = useState(true)
  const employee = FILTER_EMPLOYEES[index]
  if (!active) return <span data-testid="filter-cleared">full sheet</span>
  return (
    <TimesheetCodeFilterBar
      {...props}
      employeeCount={FILTER_EMPLOYEES.length}
      position={index + 1}
      employeeId={employee[0]}
      employeeName={employee[1]}
      onPrevious={() =>
        setIndex((current) => (current - 1 + FILTER_EMPLOYEES.length) % FILTER_EMPLOYEES.length)
      }
      onNext={() => setIndex((current) => (current + 1) % FILTER_EMPLOYEES.length)}
      onClear={() => setActive(false)}
    />
  )
}

describe('TimesheetCodeFilterBar navigation harness', () => {
  it('wraps Previous from first and Next from last, and Clear restores the sheet', async () => {
    const user = userEvent.setup()
    render(<NavigationHarness />)

    expect(screen.getByText('1 of 4')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /previous employee/i }))
    expect(screen.getByText('4 of 4')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /next employee/i }))
    expect(screen.getByText('1 of 4')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /clear filter/i }))
    expect(screen.getByTestId('filter-cleared')).toHaveTextContent('full sheet')
  })
})

describe('TimesheetCodeFilterBar', () => {
  it('names the filtering code by glyph and by meaning', () => {
    const { container } = render(<TimesheetCodeFilterBar {...props} />)
    // The glyph resolves the workbook's own conditional-format token, exactly
    // as the grid cells and the legend do — no second palette anywhere.
    const glyph = container.querySelector('[data-code="AL"]')
    expect(glyph).not.toBeNull()
    expect(glyph).toHaveTextContent('AL')
    // And the words beside it, because a fill is not a state.
    expect(screen.getByText('Annual leave')).toBeInTheDocument()
  })

  it('states how many employees and how many cells matched', () => {
    render(<TimesheetCodeFilterBar {...props} />)
    expect(screen.getByText('4 employees')).toBeInTheDocument()
    expect(screen.getByText('5 cells')).toBeInTheDocument()
  })

  it('names the employee the sheet is parked on, in a live region', () => {
    render(<TimesheetCodeFilterBar {...props} />)
    const id = screen.getByText('G7014')
    expect(id).toBeInTheDocument()
    expect(screen.getByText('MOHAMMED ASLAM')).toBeInTheDocument()
    // Pressing Next moves the sheet and changes only this text. Without a live
    // region a screen-reader operator presses Next and is told nothing.
    expect(id.closest('[aria-live="polite"]')).not.toBeNull()
  })

  it('prints the position 1-based against the employee total', () => {
    render(<TimesheetCodeFilterBar {...props} position={3} />)
    expect(screen.getByText('3 of 4')).toBeInTheDocument()
  })

  it('announces the strip as the filter it is', () => {
    render(<TimesheetCodeFilterBar {...props} />)
    // Tabbing straight into Previous otherwise gives no clue which list is
    // being walked, or why the roster is short.
    expect(
      screen.getByRole('group', { name: /filtered by\s+annual leave/i }),
    ).toBeInTheDocument()
  })

  it('reports Previous from a control named for employees', async () => {
    const onPrevious = vi.fn()
    render(<TimesheetCodeFilterBar {...props} onPrevious={onPrevious} />)
    await userEvent.click(screen.getByRole('button', { name: /previous employee/i }))
    expect(onPrevious).toHaveBeenCalledTimes(1)
  })

  it('reports Next from a control named for employees', async () => {
    const onNext = vi.fn()
    render(<TimesheetCodeFilterBar {...props} onNext={onNext} />)
    await userEvent.click(screen.getByRole('button', { name: /next employee/i }))
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('reports Clear from a control named for the filter', async () => {
    const onClear = vi.fn()
    render(<TimesheetCodeFilterBar {...props} onClear={onClear} />)
    await userEvent.click(screen.getByRole('button', { name: /clear filter/i }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('reaches and fires all three controls from the keyboard alone', async () => {
    const onPrevious = vi.fn()
    const onNext = vi.fn()
    const onClear = vi.fn()
    render(
      <TimesheetCodeFilterBar
        {...props}
        onPrevious={onPrevious}
        onNext={onNext}
        onClear={onClear}
      />,
    )

    // Three tab stops in reading order, each answering Enter. A clickable
    // `<div>` passes all three click cases above and fails right here.
    await userEvent.tab()
    expect(screen.getByRole('button', { name: /previous employee/i })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await userEvent.tab()
    expect(screen.getByRole('button', { name: /next employee/i })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await userEvent.tab()
    expect(screen.getByRole('button', { name: /clear filter/i })).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    expect([onPrevious, onNext, onClear].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1])
  })
})

describe('TimesheetCodeFilterBar (Arabic)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('labels the code, the totals and every control in Arabic', () => {
    render(<TimesheetCodeFilterBar {...props} />)
    expect(screen.getByRole('button', { name: 'الموظف السابق' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'الموظف التالي' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'مسح التصفية' })).toBeInTheDocument()
    expect(screen.getByText('إجازة سنوية')).toBeInTheDocument()
    expect(screen.getByText('4 موظفين')).toBeInTheDocument()
    expect(screen.getByText('5 خلايا')).toBeInTheDocument()
  })

  it('leaves no English beside the Arabic copy', () => {
    render(<TimesheetCodeFilterBar {...props} />)
    expect(screen.queryByText('Annual leave')).toBeNull()
    expect(screen.queryByText('4 employees')).toBeNull()
    expect(screen.queryByText('5 cells')).toBeNull()
    expect(screen.queryByText('1 of 4')).toBeNull()
    expect(screen.queryByRole('button', { name: /previous|next|clear/i })).toBeNull()
  })

  it('isolates the Latin employee id and the numerals inside the Arabic strip', () => {
    render(<TimesheetCodeFilterBar {...props} />)
    // A G-number is a Latin run in an Arabic paragraph: unisolated, bidi drags
    // it to the far end of the strip, away from the name it belongs to.
    const id = screen.getByText('G7014')
    expect(id).toHaveAttribute('dir', 'ltr')
    expect(id.className).toContain('[unicode-bidi:isolate]')
    // Two numerals with Arabic words between them, isolated as one phrase.
    expect(screen.getByText('1 من 4').className).toContain('[unicode-bidi:isolate]')
    // The bar declares no direction of its own, so the whole strip mirrors with
    // the page instead of being pinned LTR by its own container.
    expect(screen.getByTestId('code-filter-bar')).not.toHaveAttribute('dir')
  })
})
