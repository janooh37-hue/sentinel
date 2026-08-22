/**
 * The checks panel: blocking, warnings, then roster movement (UI spec §16.4,
 * §16.5).
 *
 * The load-bearing fact this file pins: `warnings` is recomputed live even on a
 * sealed month, so an `Issue.employee_id` may name someone with NO row in the
 * same payload. Nothing here joins an issue to a row.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { ChecksPanel } from './ChecksPanel'

function wrap(ui: React.ReactNode, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  // The panels link to the employee record now (UI spec §9), so the wrapper
  // needs a router — the navigating-page pattern from
  // components/employees/EmployeeActivitySection.test.tsx:112-118.
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>
  )
}

function renderPanel(ui: React.ReactNode) {
  return render(wrap(ui))
}

const props = {
  // Task 3's `Issue`, exactly: employee_id, kind, detail. The panel localises
  // `kind` itself via t(`timesheet.issues.${kind}`); the server sends no prose.
  blocking: [{ employee_id: 'G7099', kind: 'no_designation', detail: 'G7099 NAWAF AL BALUSHI' }],
  warnings: [],
  // `joined` and `leaving` are derived by TimesheetPage from `rows`, not sent.
  joined: [
    { employee_id: 'G7176', name_en: 'FAISAL AKRAM JAVED', day: 10, confirmed: false },
  ],
  leaving: [
    { employee_id: 'G7141', name_en: 'MD RASEL HOWLADER', day: 17, confirmed: true },
  ],
  // `removed` is Task 3's `Removed`, including `year`.
  removed: [
    {
      employee_id: 'G7169',
      name_en: 'SURESH BABU PILLAI',
      last_day: 17,
      month: 6,
      year: 2026,
      end_date: '2026-06-17',
    },
  ],
  month: 7,
  year: 2026,
  closed: false,
  canEdit: true,
  // Who has a row on the sheet on screen. A finding may name somebody who has
  // none — the whole reason this arrives as a set rather than as a join.
  rosterEmployeeIds: new Set(['G7099', 'G7176', 'G7141']),
  onAcknowledge: vi.fn(),
  onShowRow: vi.fn(),
}

describe('ChecksPanel', () => {
  it('states the starting point of a mid-month joiner and acknowledges it', async () => {
    const onAcknowledge = vi.fn()
    renderPanel(<ChecksPanel {...props} onAcknowledge={onAcknowledge} />)
    // UI spec §16.4's sentence template is "Started on day {N} of {Month} —
    // days 1–{N-1} are NG until you say otherwise". This fixture joins on day 10.
    expect(await screen.findByText(/days 1–9 are NG/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /confirm starting point/i }))
    expect(onAcknowledge).toHaveBeenCalledWith('G7176')
  })

  it('says who left and that he is off the next sheet', async () => {
    renderPanel(<ChecksPanel {...props} />)
    expect(await screen.findByText(/off next month's sheet/i)).toBeInTheDocument()
  })

  it('says who was removed and why', async () => {
    renderPanel(<ChecksPanel {...props} />)
    expect(await screen.findByText(/SURESH BABU PILLAI/)).toBeInTheDocument()
    expect(
      screen.getByText(/not on this month's attendance sheet or statistics/i),
    ).toBeInTheDocument()
  })

  it('localises the blocking kind and keeps the server\u2019s own detail beside it', async () => {
    renderPanel(<ChecksPanel {...props} />)
    // `kind` is the stable machine string; the panel owns the words.
    expect(await screen.findByText(/no designation/i)).toBeInTheDocument()
    expect(screen.getByText('G7099 NAWAF AL BALUSHI')).toBeInTheDocument()
    expect(screen.queryByText('no_designation')).not.toBeInTheDocument()
  })

  /**
   * `MonthGrid.warnings` is recomputed live even on a closed month, so
   * `departed_but_active` is deliberately reported for people with no row at
   * all. The panel is keyed by employee and must render the finding whole.
   */
  it('renders an issue whose employee has no row in the grid', async () => {
    renderPanel(
      <ChecksPanel
        {...props}
        // Nobody on this sheet either, so there is no row to jump to and the
        // finding is informational — which is what the assertions below pin.
        rosterEmployeeIds={new Set()}
        // Nobody in `joined` / `leaving` / `removed` and no row anywhere:
        // exactly the shape a live recompute produces after the seal.
        warnings={[
          {
            employee_id: 'G6001',
            kind: 'departed_but_active',
            detail: 'OMAR SAEED finished on 2026-05-31 but is still Active.',
          },
        ]}
        joined={[]}
        leaving={[]}
        removed={[]}
      />,
    )
    // The server's own sentence, whole, with no row anywhere to hang it on.
    expect(
      await screen.findByText('OMAR SAEED finished on 2026-05-31 but is still Active.'),
    ).toBeInTheDocument()
    expect(screen.getByText('G6001')).toBeInTheDocument()
    expect(screen.getByText('Departed but still active')).toBeInTheDocument()
    // Not offered a `Show row` it cannot honour.
    expect(screen.queryByRole('button', { name: /show row/i })).not.toBeInTheDocument()
  })

  it('shows the row of a mid-month joiner', async () => {
    const onShowRow = vi.fn()
    renderPanel(<ChecksPanel {...props} onShowRow={onShowRow} />)
    const line = await screen.findByTestId('check-joined-G7176')
    await userEvent.click(within(line).getByRole('button', { name: /show row/i }))
    expect(onShowRow).toHaveBeenCalledWith('G7176')
  })

  /**
   * The two actions on one finding are separate CONTROLS, not one control with
   * two meanings: the row jump moves the sheet, the record link leaves the
   * page. Nested, either gesture would fire the other — a click on `Show row`
   * inside a `<Link>` navigates away from the month it was meant to scroll.
   */
  it('jumps to the row of a finding whose man is on this sheet', async () => {
    const onShowRow = vi.fn()
    renderPanel(<ChecksPanel {...props} onShowRow={onShowRow} />)
    const line = await screen.findByTestId('check-issue-G7099-no_designation')

    await userEvent.click(within(line).getByRole('button', { name: /G7099/ }))
    expect(onShowRow).toHaveBeenCalledWith('G7099')
    await userEvent.click(within(line).getByRole('button', { name: /show row/i }))
    expect(onShowRow).toHaveBeenCalledTimes(2)

    const profile = within(line).getByRole('link', { name: /open record/i })
    expect(profile).toHaveAttribute('href', '/employees/G7099')
    expect(profile.querySelector('button')).toBeNull()
    expect(within(line).getByRole('button', { name: /show row/i }).closest('a')).toBeNull()
  })

  it('leaves a finding with no row on this sheet informational', async () => {
    const onShowRow = vi.fn()
    renderPanel(
      <ChecksPanel
        {...props}
        blocking={[]}
        warnings={[
          {
            employee_id: 'G6001',
            kind: 'departed_but_active',
            detail: 'OMAR SAEED is still Active.',
          },
        ]}
        joined={[]}
        leaving={[]}
        onShowRow={onShowRow}
      />,
    )
    const line = await screen.findByTestId('check-issue-G6001-departed_but_active')
    // No jump it cannot honour, and the route to the person still there.
    expect(within(line).queryByRole('button')).not.toBeInTheDocument()
    expect(within(line).getByRole('link', { name: /open record/i })).toHaveAttribute(
      'href',
      '/employees/G6001',
    )
  })

  /**
   * `start-ack` is `timesheet.edit` and the backend ALLOWS it on a closed
   * month: accepting a starting point changes no cell, so it is not a
   * correction to a sealed workbook.
   */
  it('still confirms a starting point on a closed month', async () => {
    const onAcknowledge = vi.fn()
    renderPanel(<ChecksPanel {...props} closed onAcknowledge={onAcknowledge} />)
    await userEvent.click(
      await screen.findByRole('button', { name: /confirm starting point/i }),
    )
    expect(onAcknowledge).toHaveBeenCalledWith('G7176')
  })

  it('offers no confirmation to a read-only operator', async () => {
    renderPanel(<ChecksPanel {...props} canEdit={false} />)
    expect(await screen.findByText(/days 1–9 are NG/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /confirm starting point/i }),
    ).not.toBeInTheDocument()
  })

  it('says the starting point is already accepted instead of asking again', async () => {
    renderPanel(
      <ChecksPanel
        {...props}
        joined={[{ employee_id: 'G7176', name_en: 'FAISAL AKRAM JAVED', day: 10, confirmed: true }]}
      />,
    )
    expect(await screen.findByText(/starting point confirmed/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /confirm starting point/i }),
    ).not.toBeInTheDocument()
  })

  /**
   * A kind nobody has translated falls back to the server's own sentence — so
   * the muted detail beside it must NOT render, or the same sentence is printed
   * twice side by side in exactly the case the fallback exists for.
   */
  it('prints an untranslated kind\u2019s sentence once, not twice', async () => {
    renderPanel(
      <ChecksPanel
        {...props}
        blocking={[{ employee_id: 'G7099', kind: 'brand_new_kind', detail: 'Something the UI has never heard of.' }]}
      />,
    )
    expect(
      await screen.findAllByText('Something the UI has never heard of.'),
    ).toHaveLength(1)
    expect(screen.queryByText(/timesheet\.issues/)).not.toBeInTheDocument()
  })

  /**
   * UI spec §9: the rows link to the employee that fixes it. A record link, not
   * a grid row — which is why it works for an issue naming somebody with no row.
   */
  it('routes every finding to the employee record, row or no row', async () => {
    renderPanel(
      <ChecksPanel
        {...props}
        warnings={[
          { employee_id: 'G6001', kind: 'departed_but_active', detail: 'OMAR SAEED is still Active.' },
        ]}
      />,
    )
    const links = await screen.findAllByRole('link', { name: /open record/i })
    const targets = links.map((a) => a.getAttribute('href'))
    expect(targets).toContain('/employees/G7099')
    // The employee with NO row on this sheet still gets a route.
    expect(targets).toContain('/employees/G6001')
  })

  it('says every check passed when there is nothing to fix', async () => {
    renderPanel(<ChecksPanel {...props} blocking={[]} warnings={[]} />)
    expect(await screen.findByText(/every check passed/i)).toBeInTheDocument()
  })
})
