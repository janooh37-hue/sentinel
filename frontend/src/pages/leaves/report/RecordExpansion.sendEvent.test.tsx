/**
 * RecordExpansion — SendButton eventType dispatched for sick vs annual rows.
 *
 * Uses a data-attribute mock so we can read the prop without mocking the full
 * notifications stack (auth / useCapabilities / API calls).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RecordExpansion } from './RecordExpansion'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      getLeave: vi.fn(),
      getLeaveBalance: vi.fn().mockResolvedValue({}),
      updateLeave: vi.fn().mockResolvedValue({}),
    },
  }
})

// SendButton mock that renders a data-attribute so the eventType prop is observable.
vi.mock('@/components/notify/SendButton', () => ({
  SendButton: ({ eventType, recordId }: { eventType: string; recordId: number }) => (
    <span data-testid="send-button" data-event-type={eventType} data-record-id={String(recordId)} />
  ),
}))

function renderRow(row: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <RecordExpansion row={row as never} today="2026-07-15" onMutated={() => {}} />
    </QueryClientProvider>,
  )
}

const APPROVED_ANNUAL = {
  id: 10,
  employee_id: 'G1',
  leave_type: 'Annual Leave',
  start_date: '2026-08-01',
  end_date: '2026-08-25',
  days: 25,
  status: 'Approved',
  created_at: '2026-07-01T00:00:00',
}

const APPROVED_SICK = {
  id: 20,
  employee_id: 'G2',
  leave_type: 'Sick Leave',
  start_date: '2026-07-10',
  end_date: '2026-07-12',
  days: 3,
  status: 'Approved',
  created_at: '2026-07-10T00:00:00',
}

describe('SendButton eventType', () => {
  it('passes leave_approved for an Annual Approved row', () => {
    renderRow(APPROVED_ANNUAL)
    expect(screen.getByTestId('send-button')).toHaveAttribute(
      'data-event-type',
      'leave_approved',
    )
  })

  it('passes sick_leave_registered for a Sick Leave Approved row', () => {
    renderRow(APPROVED_SICK)
    expect(screen.getByTestId('send-button')).toHaveAttribute(
      'data-event-type',
      'sick_leave_registered',
    )
  })
})
