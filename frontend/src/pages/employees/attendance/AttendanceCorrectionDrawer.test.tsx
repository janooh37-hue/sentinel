import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'

import ar from '@/locales/ar.json'

const { getAttendanceCase, createAttendanceAdjustment, revokeAttendanceAdjustment, hasCapability } = vi.hoisted(() => ({
  getAttendanceCase: vi.fn(),
  createAttendanceAdjustment: vi.fn(),
  revokeAttendanceAdjustment: vi.fn(),
  hasCapability: vi.fn(),
}))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: new Set<string>(),
    isLoading: false,
    has: hasCapability,
  }),
}))

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return {
    ...real,
    api: {
      ...real.api,
      getAttendanceCase,
      createAttendanceAdjustment,
      revokeAttendanceAdjustment,
    },
  }
})


import { ApiError } from '@/lib/api'

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
  punches: [{ occurred_at: '2026-08-19T00:58:00', device_name: 'Main Gate Terminal' }],
  effective: {
    presence_state: 'completed',
    reason_code: 'PUNCH_OUT_RECORDED',
    first_in_at: '2026-08-19T01:00:00',
    latest_in_at: '2026-08-19T01:05:00',
    final_out_at: '2026-08-19T09:00:00',
    late_minutes: 5,
    adjustment_id: 4,
    early_exit_minutes: 2,
    missing_checkout: false,
  },
  evaluations: [
    { id: 8, revision: 1, presence_state: 'completed', reason_code: 'PUNCH_OUT_RECORDED', evaluated_at: '2026-08-19T09:01:00' },
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
  return { client, onClose }
}

beforeEach(() => {
  getAttendanceCase.mockReset()
  createAttendanceAdjustment.mockReset()
  revokeAttendanceAdjustment.mockReset()
  hasCapability.mockReset()
  hasCapability.mockReturnValue(false)
})

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
    expect(screen.getByText('2026-08-19T01:00:00')).toBeInTheDocument()
    expect(screen.getByText('2026-08-19T01:05:00')).toBeInTheDocument()
    expect(screen.getByText('2026-08-19T09:00:00')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getAllByText('2')).not.toHaveLength(0)
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
      data: { ...CASE, name_ar: 'أحمد علي' },
      etag: 'case-v1',
    })
    renderDrawer()

    expect(await screen.findByText('أحمد علي')).toBeInTheDocument()
    expect(screen.queryByText('Ahmed Ali')).not.toBeInTheDocument()
    expect(screen.getAllByText('مكتمل')).not.toHaveLength(0)
    expect(screen.getByRole('dialog')).toHaveTextContent('تم تسجيل الخروج')
  })

  it('sends a changed correction with the current case ETag and invalidates attendance queries', async () => {
    const user = userEvent.setup()
    hasCapability.mockReturnValue(true)
    getAttendanceCase.mockResolvedValue({ data: CASE, etag: 'case-v1' })
    createAttendanceAdjustment.mockResolvedValue({ data: { id: 5, case_id: 42 }, etag: 'case-v2' })
    const { client } = renderDrawer()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    await screen.findByText('Source facts')
    await user.selectOptions(screen.getByLabelText('Correction presence'), 'absent')
    await user.type(screen.getByLabelText('Correction reason'), 'Supervisor register')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))

    await waitFor(() => expect(createAttendanceAdjustment).toHaveBeenCalledWith(42, 'case-v1', {
      replacement_presence_state: 'absent',
      replacement_first_in_at: '2026-08-19T01:00:00',
      replacement_latest_in_at: '2026-08-19T01:05:00',
      replacement_final_out_at: '2026-08-19T09:00:00',
      replacement_late_minutes: 5,
      replacement_early_exit_minutes: 2,
      replacement_missing_checkout: false,
      reason: 'Supervisor register',
    }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['attendance-case', 42] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['attendance-exceptions'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['attendance-day'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['employee-attendance'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['workforce', 'snapshot'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['workforce', 'coverage'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notification-counts'] })
  })

  it('prevents a correction with a blank reason from reaching the API', async () => {
    const user = userEvent.setup()
    hasCapability.mockReturnValue(true)
    getAttendanceCase.mockResolvedValue({ data: CASE, etag: 'case-v1' })
    renderDrawer()

    await screen.findByText('Correction')
    await user.selectOptions(screen.getByLabelText('Correction presence'), 'absent')
    const save = screen.getByRole('button', { name: 'Save correction' })
    expect(save).toBeDisabled()
    await user.click(save)
    expect(createAttendanceAdjustment).not.toHaveBeenCalled()
  })

  it('revokes the effective correction only after a reason and confirmation using the refreshed ETag', async () => {
    const user = userEvent.setup()
    hasCapability.mockReturnValue(true)
    getAttendanceCase
      .mockResolvedValueOnce({ data: CASE, etag: 'case-v1' })
      .mockResolvedValue({ data: CASE, etag: 'case-v2' })
    createAttendanceAdjustment.mockResolvedValue({ data: { id: 5, case_id: 42 }, etag: 'case-v2' })
    revokeAttendanceAdjustment.mockResolvedValue({ data: { id: 4, revoked_at: '2026-08-19T11:00:00Z' }, etag: 'case-v3' })
    const { client } = renderDrawer()
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    await screen.findByText('Correction')
    await user.selectOptions(screen.getByLabelText('Correction presence'), 'absent')
    await user.type(screen.getByLabelText('Correction reason'), 'Supervisor register')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    await waitFor(() => expect(createAttendanceAdjustment).toHaveBeenCalledOnce())
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['workforce', 'coverage'] }))
    invalidate.mockClear()

    const revoke = screen.getByRole('button', { name: 'Revoke correction' })
    expect(revoke).toBeDisabled()
    await user.type(screen.getByLabelText('Revoke reason'), 'Duplicate entry')
    await user.click(revoke)
    await user.click(await screen.findByRole('button', { name: 'Confirm revoke' }))

    await waitFor(() => expect(revokeAttendanceAdjustment).toHaveBeenCalledWith(
      42,
      4,
      'case-v2',
      { reason: 'Duplicate entry' },
    ))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['workforce', 'snapshot'] }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['workforce', 'coverage'] })
  })

  it('does not submit a cached draft after the case ETag refreshes', async () => {
    const user = userEvent.setup()
    hasCapability.mockReturnValue(true)
    getAttendanceCase
      .mockResolvedValueOnce({ data: CASE, etag: 'case-v1' })
      .mockResolvedValue({ data: { ...CASE, effective: { ...CASE.effective, late_minutes: 9 } }, etag: 'case-v2' })
    const { client } = renderDrawer()

    await screen.findByText('Correction')
    await user.selectOptions(screen.getByLabelText('Correction presence'), 'absent')
    await user.type(screen.getByLabelText('Correction reason'), 'Supervisor register')

    await client.invalidateQueries({ queryKey: ['attendance-case', 42] })

    await waitFor(() => expect(getAttendanceCase).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByLabelText('Correction presence')).toHaveValue('completed'))
    expect(screen.getByLabelText('Correction reason')).toHaveValue('')
    expect(screen.getByLabelText('Late minutes')).toHaveValue(9)

    const save = screen.getByRole('button', { name: 'Save correction' })
    expect(save).toBeDisabled()
    await user.click(save)
    expect(createAttendanceAdjustment).not.toHaveBeenCalled()
  })

  it('restores the conflicted draft on refreshed evidence without retrying', async () => {
    const user = userEvent.setup()
    hasCapability.mockReturnValue(true)
    getAttendanceCase
      .mockResolvedValueOnce({ data: CASE, etag: 'case-v1' })
      .mockResolvedValue({ data: { ...CASE, effective: { ...CASE.effective, late_minutes: 9 } }, etag: 'case-v2' })
    createAttendanceAdjustment.mockRejectedValue(
      new ApiError(412, 'ATTENDANCE_CASE_VERSION_CONFLICT', 'Case changed'),
    )
    renderDrawer()

    await screen.findByText('Correction')
    await user.selectOptions(screen.getByLabelText('Correction presence'), 'absent')
    await user.type(screen.getByLabelText('Correction reason'), 'Supervisor register')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))

    expect(await screen.findByText(/This attendance case changed/)).toBeInTheDocument()
    await waitFor(() => expect(getAttendanceCase).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('Correction presence')).toHaveValue('absent')
    expect(screen.getByLabelText('Correction reason')).toHaveValue('Supervisor register')
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeEnabled()
    expect(createAttendanceAdjustment).toHaveBeenCalledOnce()
  })
})
