/**
 * The checks panel: blocking, warnings, then roster movement (UI spec §16.4,
 * §16.5).
 *
 * The load-bearing fact this file pins: `warnings` is recomputed live even on a
 * sealed month, so an `Issue.employee_id` may name someone with NO row in the
 * same payload. Nothing here joins an issue to a row.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ChecksPanel } from './ChecksPanel'

function renderPanel(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
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
  onAcknowledge: vi.fn(),
  onSelect: vi.fn(),
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
    expect(await screen.findByText(/still active/i)).toBeInTheDocument()
    expect(screen.getByText('G6001')).toBeInTheDocument()
    expect(screen.getByText(/departed but still active/i)).toBeInTheDocument()
    // Not offered a `Show row` it cannot honour.
    expect(screen.queryByRole('button', { name: /show row/i })).not.toBeInTheDocument()
  })

  it('shows the row of somebody who has one', async () => {
    const onSelect = vi.fn()
    renderPanel(<ChecksPanel {...props} onSelect={onSelect} />)
    const show = await screen.findAllByRole('button', { name: /show row/i })
    await userEvent.click(show[0])
    expect(onSelect).toHaveBeenCalledWith('G7176')
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

  it('says every check passed when there is nothing to fix', async () => {
    renderPanel(<ChecksPanel {...props} blocking={[]} warnings={[]} />)
    expect(await screen.findByText(/every check passed/i)).toBeInTheDocument()
  })
})
