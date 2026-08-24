/**
 * EmployeeIdCard — the time-sheet action on the employee record.
 *
 * The card is the record's ONLY action surface: `EmployeeDetailPage` has no
 * `isMobile`, no `DropdownMenu` and no `md:hidden` / `hidden md:` pair anywhere
 * in the file — it hands three callbacks to this one child, and the card's
 * action row is a single responsive flex row inside a sidebar that stacks below
 * `md` (`EmployeeDetailPage.tsx:245-248`). So one button covers both viewports
 * and there is no second surface to keep in step.
 *
 * Wrapper: `QueryClientProvider` (the card owns `useEmployeePhoto`'s mutations)
 * plus a mocked `useCapabilities`, which is the repo's way of flipping one
 * capability per test — `components/perms/CapabilityGate.test.tsx:69-73`. The
 * real i18n is deliberately left in place (`src/test/setup.ts` initialises `en`
 * synchronously): every label under test is INTERPOLATED, so a `t: (k) => k`
 * stub would assert the key back to itself and prove nothing about the month.
 *
 * `Date` alone is faked (`toFake: ['Date']`), not the timer queue: the month a
 * record offers is derived from today, and leaving `setTimeout` real keeps
 * React's and react-query's scheduling untouched.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const caps = vi.hoisted(() => new Set<string>())

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: caps,
    isLoading: false,
    has: (cap: string) => caps.has(cap),
  }),
}))

import type { EmployeeRead } from '@/lib/api'
import { EmployeeIdCard } from './EmployeeIdCard'

const EMPLOYEE = {
  id: 'G7141',
  name_en: 'Rasel Miah',
  name_ar: 'راسل ميه',
  status: 'Active',
  pending_status: null,
  end_date: null,
  has_photo: false,
  department: 'Security',
  duty_unit: 'JD 908',
  position: 'Security Guard',
} as unknown as EmployeeRead

function wrap(employee: EmployeeRead, onTimesheet = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <EmployeeIdCard
        employee={employee}
        onEdit={vi.fn()}
        onAddLeave={vi.fn()}
        onGenerate={vi.fn()}
        onTimesheet={onTimesheet}
      />
    </QueryClientProvider>,
  )
  return onTimesheet
}

beforeEach(() => {
  caps.clear()
  // 21 Aug 2026, local — so the month that just ended is July 2026.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 7, 21))
})
afterEach(() => vi.useRealTimers())

describe('EmployeeIdCard — the time-sheet action', () => {
  it('offers the month that just ended for an employee who is still on the roster', () => {
    caps.add('timesheet.view')
    const onTimesheet = wrap(EMPLOYEE)

    // The workbooks are produced after a month closes, not during it — the
    // same rule the time-sheet page opens on.
    const button = screen.getByRole('button', { name: 'Time sheet · July' })
    fireEvent.click(button)
    expect(onTimesheet).toHaveBeenCalledTimes(1)
    expect(onTimesheet).toHaveBeenCalledWith({ year: 2026, month: 7, months: 1 })
  })

  it('asks for the departure month and the one before it once a record has an end date', () => {
    caps.add('timesheet.view')
    const onTimesheet = wrap({ ...EMPLOYEE, end_date: '2026-03-31' } as EmployeeRead)

    const button = screen.getByRole('button', { name: 'Time sheet · 2 months' })
    // ONE workbook, two sheets, earlier first, named for the later month — so
    // the button states the span rather than claiming two files.
    expect(button).toHaveAttribute(
      'title',
      expect.stringContaining('February and March 2026'),
    )
    // Visible, not hover-only: a `title` is a description no keyboard or touch
    // operator ever reads.
    expect(screen.getByText('Both months: February and March 2026.')).toBeInTheDocument()
    fireEvent.click(button)
    // The month of departure. The server adds the month before it.
    expect(onTimesheet).toHaveBeenCalledWith({ year: 2026, month: 3, months: 2 })
  })

  it('names December of the previous year for a January departure', () => {
    // The trap: `new Date('2026-01-15')` is UTC midnight, so `getMonth()` west
    // of Greenwich reads December and the record would fetch the wrong month.
    caps.add('timesheet.view')
    const onTimesheet = wrap({ ...EMPLOYEE, end_date: '2026-01-15' } as EmployeeRead)

    const button = screen.getByRole('button', { name: 'Time sheet · 2 months' })
    expect(button).toHaveAttribute(
      'title',
      expect.stringContaining('December 2025 and January 2026'),
    )
    fireEvent.click(button)
    expect(onTimesheet).toHaveBeenCalledWith({ year: 2026, month: 1, months: 2 })
  })

  it('offers the ordinary single month for a departure that has not happened yet', () => {
    // A resignation dated ahead keeps `status` Active and parks the target in
    // `pending_status`; the row is still live. Nothing downstream would refuse
    // the two-month export — a live row is seeded `P` on every day, and the
    // span renderer only 404s when the employee is on neither month — so the
    // operator would be handed a workbook asserting a manned post on days that
    // have not happened, AND would lose the last-completed-month export for
    // this employee until the nightly flip.
    caps.add('timesheet.view')
    const onTimesheet = wrap({
      ...EMPLOYEE,
      status: 'Active',
      pending_status: 'Resigned',
      end_date: '2026-09-30',
    } as EmployeeRead)

    fireEvent.click(screen.getByRole('button', { name: 'Time sheet · July' }))
    expect(onTimesheet).toHaveBeenCalledWith({ year: 2026, month: 7, months: 1 })
    expect(screen.queryByText(/Both months/)).not.toBeInTheDocument()
  })

  it('still takes two months for a departure in the month that just ended', () => {
    // The boundary itself: August has not ended, July has. A departure dated
    // inside the last completed month is the handover.
    caps.add('timesheet.view')
    const onTimesheet = wrap({ ...EMPLOYEE, end_date: '2026-07-31' } as EmployeeRead)

    fireEvent.click(screen.getByRole('button', { name: 'Time sheet · 2 months' }))
    expect(onTimesheet).toHaveBeenCalledWith({ year: 2026, month: 7, months: 2 })
  })

  it('treats an unparseable end date as no departure at all', () => {
    caps.add('timesheet.view')
    const onTimesheet = wrap({ ...EMPLOYEE, end_date: 'not-a-date' } as EmployeeRead)

    fireEvent.click(screen.getByRole('button', { name: 'Time sheet · July' }))
    expect(onTimesheet).toHaveBeenCalledWith({ year: 2026, month: 7, months: 1 })
  })

  it('withholds the action from an operator who cannot see the time sheet', () => {
    caps.add('employees.edit')
    wrap(EMPLOYEE)

    expect(screen.queryByRole('button', { name: /Time sheet/ })).not.toBeInTheDocument()
    // The rest of the card is untouched.
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('offers it to an operator who may read the sheet but not edit the record', () => {
    // Amendment A3: `timesheet.view` is the operator capability and the
    // per-employee export freezes nothing, so this is exactly the case that
    // must work.
    caps.add('timesheet.view')
    wrap(EMPLOYEE)

    expect(screen.getByRole('button', { name: 'Time sheet · July' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })
})
