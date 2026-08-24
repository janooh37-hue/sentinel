import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const { getAttendanceCase } = vi.hoisted(() => ({ getAttendanceCase: vi.fn() }))

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return { ...real, api: { ...real.api, getAttendanceCase } }
})

import { AttendanceCorrectionDrawer } from './AttendanceCorrectionDrawer'

const CASE = {
  id: 42,
  employee_id: 'G-9001',
  name_en: 'Ahmed Ali',
  name_ar: null,
  operational_date: '2026-08-19',
  scheduled_start_at: '2026-08-19T01:00:00',
  scheduled_end_at: '2026-08-19T09:00:00',
  department_snapshot: 'Security',
  duty_unit_snapshot: 'Main Gate',
  duty_post_snapshot: 'Gate 1',
  crew_code_snapshot: 'A',
  crew_name_snapshot: 'Alpha Crew',
  shift_code_snapshot: 'morning',
  organization_snapshot_state: 'active',
  punches: [{ occurred_at: '2026-08-19T00:58:00', device_name: 'Main Gate Terminal' }],
  effective: { presence_state: 'late', late_minutes: 12 },
  evaluations: [
    { id: 8, revision: 1, presence_state: 'late', reason_code: 'late_arrival', evaluated_at: '2026-08-19T09:01:00' },
  ],
  adjustments: [
    { id: 4, base_evaluation_id: 8, reason: 'Verified with supervisor', created_at: '2026-08-19T10:00:00', revoked_at: null },
  ],
  adjustment_audit: [
    { adjustment_id: 4, action: 'created', actor: 'Duty Officer', occurred_at: '2026-08-19T10:00:00', reason: 'Verified with supervisor' },
  ],
}

function renderDrawer(caseId: number | null = 42) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <AttendanceCorrectionDrawer caseId={caseId} onClose={onClose} />
    </QueryClientProvider>,
  )
  return { onClose }
}

describe('AttendanceCorrectionDrawer', () => {
  it('shows the selected case as separated source, automatic, and human evidence', async () => {
    getAttendanceCase.mockResolvedValue({ data: CASE, etag: 'case-v1' })
    renderDrawer()

    await waitFor(() => expect(getAttendanceCase).toHaveBeenCalledWith(42))
    expect(await screen.findByText('Source facts')).toBeInTheDocument()
    expect(screen.getByText('Automatic evaluations')).toBeInTheDocument()
    expect(screen.getByText('Human corrections')).toBeInTheDocument()
    expect(screen.getByText('Main Gate / Gate 1')).toBeInTheDocument()
    expect(screen.getByText('Main Gate Terminal')).toBeInTheDocument()
    expect(screen.getByText('Duty Officer')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })

  it('closes explicitly without exposing mutation controls', async () => {
    const user = userEvent.setup()
    getAttendanceCase.mockResolvedValue({ data: CASE, etag: 'case-v1' })
    const { onClose } = renderDrawer()

    await screen.findByText('Source facts')
    expect(screen.queryByRole('button', { name: /save|correct|revoke/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
