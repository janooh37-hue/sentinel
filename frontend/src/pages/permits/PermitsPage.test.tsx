import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { statusTone, zoneTone, fmtDate } from './permitUtils'
import { PermitsPage } from './PermitsPage'

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set(['permits.view', 'permits.manage']), isLoading: false, has: () => true }),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      permitsSummary: vi.fn().mockResolvedValue({
        active: 3, expiring: 1, expired: 0, revoked: 0,
        people_active: 7, people_green: 5, people_red: 4, people_work_residence: 2,
      }),
      listPermits: vi.fn().mockResolvedValue({
        items: [
          {
            id: 1, permit_no: 'PMT-0001', company: 'Acme Contracting', zones: ['red'],
            start_date: '2026-07-01', end_date: '2026-07-30', status: 'active',
            created_at: '2026-07-01T00:00:00', derived_status: 'active',
            duration_days: 30, days_remaining: 9, people_count: 4, vehicle_count: 2,
            has_document: true,
          },
          {
            id: 2, permit_no: 'PMT-0002', company: 'Descon Engineering', zones: ['green', 'work_residence'],
            start_date: '2026-07-21', end_date: '2026-08-21', status: 'active',
            created_at: '2026-07-21T00:00:00', derived_status: 'active',
            duration_days: 32, days_remaining: 31, people_count: 5, vehicle_count: 3,
            has_document: false,
          },
        ],
        total: 2, limit: 500, offset: 0,
      }),
    },
  }
})

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <PermitsPage />
    </QueryClientProvider>,
  )
}

describe('permitUtils', () => {
  it('maps derived status to a badge tone', () => {
    expect(statusTone('active')).toBe('active')
    expect(statusTone('expiring')).toBe('warning')
    expect(statusTone('expired')).toBe('danger')
    expect(statusTone('revoked')).toBe('neutral')
  })
  it('maps zone to a badge tone', () => {
    expect(zoneTone('green')).toBe('active')
    expect(zoneTone('red')).toBe('danger')
    expect(zoneTone('work_residence')).toBe('info')
  })
  it('formats a timestamp down to the date', () => {
    expect(fmtDate('2026-07-30T12:00:00')).toBe('2026-07-30')
    expect(fmtDate(null)).toBe('—')
  })
})

describe('PermitsPage', () => {
  it('renders the register with a permit row and summary tiles', async () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /security permits/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Acme Contracting')).toBeInTheDocument())
    expect(screen.getByText('PMT-0001')).toBeInTheDocument()
    // Manager sees the "New permit" action.
    expect(screen.getByRole('button', { name: /new permit/i })).toBeInTheDocument()
  })

  it('renders multi-zone chips (incl. work residence) and a clip for attached papers', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Descon Engineering')).toBeInTheDocument())
    // A permit's zones render as separate chips — here Green + Work res.
    expect(screen.getAllByText('Work res.').length).toBeGreaterThan(0)
    // The permit with an attached scan surfaces a paperclip affordance.
    expect(screen.getByLabelText(/permit paper attached/i)).toBeInTheDocument()
    // Vehicles column is present with its header.
    expect(screen.getByRole('columnheader', { name: /vehicles/i })).toBeInTheDocument()
  })

  it('selecting a row switches Export/Print to the selected-count labels', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Acme Contracting')).toBeInTheDocument())
    const rowCheckbox = screen.getByLabelText(/select permit PMT-0001/i)
    rowCheckbox.click()
    expect(screen.getByRole('button', { name: /export 1 to csv/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /print 1/i })).toBeInTheDocument()
  })
})
