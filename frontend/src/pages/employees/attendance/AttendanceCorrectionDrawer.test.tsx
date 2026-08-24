import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'

import ar from '@/locales/ar.json'

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
    {
      id: 4,
      base_evaluation_id: 8,
      replacement_presence_state: 'completed',
      replacement_first_in_at: '2026-08-19T01:01:00',
      replacement_latest_in_at: '2026-08-19T01:12:00',
      replacement_final_out_at: '2026-08-19T09:04:00',
      replacement_late_minutes: 0,
      replacement_early_exit_minutes: 3,
      replacement_missing_checkout: false,
      reason: 'Verified with supervisor',
      created_at: '2026-08-19T10:00:00',
      revoked_at: null,
      supersedes_adjustment_id: 2,
    },
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

afterEach(async () => {
  await i18n.changeLanguage('en')
})

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
    expect(screen.getByText('2026-08-19T01:01:00')).toBeInTheDocument()
    expect(screen.getByText('2026-08-19T01:12:00')).toBeInTheDocument()
    expect(screen.getByText('2026-08-19T09:04:00')).toBeInTheDocument()
    expect(screen.getByText('Base evaluation')).toBeInTheDocument()
    expect(screen.getByText('Supersedes correction')).toBeInTheDocument()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveClass('inset-0', 'max-h-none', 'rounded-none', 'md:max-w-xl')
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

  it('uses the Arabic employee name and localized evidence labels', async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
    getAttendanceCase.mockResolvedValue({
      data: { ...CASE, name_ar: 'أحمد علي', effective: { presence_state: 'completed', reason_code: 'late_arrival' } },
      etag: 'case-v1',
    })
    renderDrawer()

    expect(await screen.findByText('أحمد علي')).toBeInTheDocument()
    expect(screen.queryByText('Ahmed Ali')).not.toBeInTheDocument()
    expect(screen.getAllByText('مكتمل')).not.toHaveLength(0)
    expect(screen.getByRole('dialog')).toHaveTextContent('تم إنشاء التصحيح')
  })
})
