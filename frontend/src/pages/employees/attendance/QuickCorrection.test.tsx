import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import type * as ApiModule from '@/lib/api'
import i18n from 'i18next'
import { useState } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ar from '@/locales/ar.json'

const { getAttendanceCase, createAttendanceAdjustment, revokeAttendanceAdjustment, hasCapability, successToast } = vi.hoisted(() => ({
  getAttendanceCase: vi.fn(),
  createAttendanceAdjustment: vi.fn(),
  revokeAttendanceAdjustment: vi.fn(),
  hasCapability: vi.fn(),
  successToast: vi.fn(),
}))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: hasCapability, isLoading: false, capabilities: new Set<string>() }),
}))
vi.mock('@/lib/toast', () => ({ toast: { success: successToast } }))
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof ApiModule>()
  return { ...real, api: { ...real.api, getAttendanceCase, createAttendanceAdjustment, revokeAttendanceAdjustment } }
})

import { ApiError } from '@/lib/api'
import type { AttendanceCase } from '@/lib/api'

import type { CorrectionTarget } from './attendanceCorrectionContext'
import { QuickCorrection } from './QuickCorrection'

const CASE: AttendanceCase = {
  id: 42,
  employee_id: 'G-9001',
  name_en: 'Ahmed Ali',
  name_ar: 'أحمد علي',
  operational_date: '2026-11-17',
  scheduled_start_at: '2026-11-17T03:00:00',
  scheduled_end_at: '2026-11-17T11:00:00',
  organization_snapshot_state: 'assigned',
  shift_code_snapshot: 'morning',
  punches: [{ occurred_at: '2026-11-17T03:10:00', device_name: 'Main Gate Terminal' }],
  effective: {
    presence_state: 'completed',
    first_in_at: '2026-11-17T03:10:00',
    latest_in_at: '2026-11-17T03:12:00',
    final_out_at: '2026-11-17T10:45:00',
    late_minutes: 10,
    early_exit_minutes: 15,
    missing_checkout: false,
    adjustment_id: 4,
  },
  adjustments: [{ id: 4, base_evaluation_id: 8, reason: 'Verified register', created_at: '2026-11-17T12:00:00' }],
  adjustment_audit: [{ adjustment_id: 4, action: 'created', actor: 'Duty Officer', occurred_at: '2026-11-17T12:00:00', reason: 'Verified register' }],
}
const TARGET: CorrectionTarget = {
  caseId: 42, employeeId: 'G-9001', employeeName: 'Ahmed Ali', operationalDate: '2026-11-17', shiftCode: 'morning',
}

function renderCorrection(target: CorrectionTarget | null = TARGET, anchorBounds?: DOMRect) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  const onClose = vi.fn()
  const onViewEvidence = vi.fn()
  const anchor = document.createElement('button')
  anchor.textContent = 'Correct Ahmed attendance'
  anchor.dataset.quickTestAnchor = 'true'
  if (anchorBounds) vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(anchorBounds)
  document.body.append(anchor)
  anchor.focus()
  function Controlled(): React.JSX.Element {
    const [current, setCurrent] = useState(target)
    return <QuickCorrection target={current} anchor={anchor}
      onClose={() => { onClose(); setCurrent(null) }}
      onViewEvidence={(caseId) => { onViewEvidence(caseId); setCurrent(null) }} />
  }
  const router = createMemoryRouter([{ path: '*', element: <Controlled /> }])
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return { client, onClose, onViewEvidence, anchor }
}

async function enterReason(user: UserEvent, details = 'Confirmed by the post supervisor') {
  await user.selectOptions(screen.getByLabelText(i18n.t('attendance.quickCorrection.reason')), 'supervisor')
  await user.type(screen.getByLabelText(i18n.t('attendance.quickCorrection.reasonText')), details)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-18T07:40:00Z'))
  getAttendanceCase.mockReset().mockResolvedValue({ data: CASE, etag: 'case-v1' })
  createAttendanceAdjustment.mockReset().mockResolvedValue({ data: { id: 5, case_id: 42 }, etag: 'case-v2' })
  revokeAttendanceAdjustment.mockReset().mockResolvedValue({ data: { id: 4, revoked_at: '2026-11-18T07:40:00Z' }, etag: 'case-v2' })
  hasCapability.mockReset().mockReturnValue(true)
  successToast.mockReset()
})

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.querySelectorAll('[data-quick-test-anchor]').forEach((element) => element.remove())
  await i18n.changeLanguage('en')
})

describe('QuickCorrection', () => {
  it('loads the case and prefills effective Dubai times with provenance and the last actor', async () => {
    renderCorrection()
    expect(await screen.findByLabelText('In time (24h)')).toHaveValue('07:10')
    expect(screen.getByLabelText(/Out time \(24h\)/)).toHaveValue('14:45')
    expect(getAttendanceCase).toHaveBeenCalledWith(42)
    expect(screen.getByText('Ahmed Ali')).toBeInTheDocument()
    expect(screen.getByText(/Morning/)).toBeInTheDocument()
    const evidence = screen.getByRole('region', { name: 'Current evidence' })
    expect(evidence).toHaveTextContent('Current effective result: Completed')
    expect(evidence).toHaveTextContent('Corrected · human correction')
    expect(screen.getByText(/Last correction: Duty Officer/)).toHaveTextContent('2026-11-17 16:00')
    expect(screen.getByText('BioTime punches stay untouched; this overlays the day')).toBeInTheDocument()
    expect(screen.queryByLabelText('In date')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Out date')).not.toBeInTheDocument()
  })

  it('anchors the desktop panel to the trigger and mirrors its logical placement in RTL', async () => {
    renderCorrection(TARGET, new DOMRect(400, 100, 44, 44))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog.style.insetInlineStart).toBe('32px'))
    expect(dialog.style.insetBlockStart).toBe('152px')
    expect(dialog.style.maxBlockSize).toBe(`${window.innerHeight - 32}px`)
    await act(async () => { await i18n.changeLanguage('ar') })
    await waitFor(() => expect(dialog.style.insetInlineStart).toBe(`${window.innerWidth - 812}px`))
  })

  it('leaves a missing Out blank instead of copying the scheduled end', async () => {
    getAttendanceCase.mockResolvedValue({
      data: { ...CASE, effective: { ...CASE.effective, presence_state: 'on_duty', final_out_at: null } }, etag: 'case-v1',
    })
    renderCorrection()
    expect(await screen.findByLabelText(/Out time \(24h\)/)).toHaveValue('')
    expect(screen.getByRole('region', { name: 'Current evidence' })).toHaveTextContent('—')
  })

  it('keeps ordinary new day-shift times saveable when the date controls are expanded', async () => {
    getAttendanceCase.mockResolvedValue({
      data: { ...CASE, effective: { presence_state: 'unknown' } }, etag: 'case-v1',
    })
    const user = userEvent.setup()
    renderCorrection()
    await user.type(await screen.findByLabelText('In time (24h)'), '07:10')
    await user.type(screen.getByLabelText(/Out time \(24h\)/), '14:45')
    await enterReason(user)
    await user.click(screen.getByRole('button', { name: 'Change dates' }))
    expect(screen.getByLabelText('In date')).toHaveValue('2026-11-17')
    expect(screen.getByLabelText('Out date')).toHaveValue('2026-11-17')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    await waitFor(() => expect(createAttendanceAdjustment).toHaveBeenCalledWith(42, 'case-v1', expect.objectContaining({
      replacement_first_in_at: '2026-11-17T03:10:00.000Z',
      replacement_final_out_at: '2026-11-17T10:45:00.000Z',
    })))
  })

  it.each([
    { language: 'en', surface: 'desktop' },
    { language: 'ar', surface: 'mobile' },
  ] as const)('saves a previous-day arrival for an after-midnight shift in $language on $surface', async ({ language, surface }) => {
    if (surface === 'mobile') {
      vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
        matches: query === '(max-width: 640px)', media: query, onchange: null,
        addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => false,
      }))
    }
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage(language)
    getAttendanceCase.mockResolvedValue({
      data: {
        ...CASE,
        operational_date: '2026-11-18',
        scheduled_start_at: '2026-11-17T20:30:00Z',
        scheduled_end_at: '2026-11-18T04:30:00Z',
        effective: { presence_state: 'unknown' },
      },
      etag: 'case-v1',
    })
    const user = userEvent.setup()
    renderCorrection({ ...TARGET, operationalDate: '2026-11-18' })
    await user.type(await screen.findByLabelText(i18n.t('attendance.quickCorrection.inTime')), '23:55')
    await enterReason(user)
    expect(screen.getByRole('button', { name: i18n.t('attendance.quickCorrection.save') })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: i18n.t('attendance.quickCorrection.changeDates') }))
    await user.selectOptions(screen.getByLabelText(i18n.t('attendance.quickCorrection.inDate')), '2026-11-17')
    await user.click(screen.getByRole('button', { name: i18n.t('attendance.quickCorrection.save') }))
    await waitFor(() => expect(createAttendanceAdjustment).toHaveBeenCalledWith(42, 'case-v1', expect.objectContaining({
      replacement_presence_state: 'on_duty',
      replacement_first_in_at: '2026-11-17T19:55:00.000Z',
      replacement_final_out_at: null,
    })))
  })

  it.each([
    { language: 'en', surface: 'desktop', changeDates: 'Change dates' },
    { language: 'ar', surface: 'mobile', changeDates: 'تغيير التواريخ' },
  ] as const)('saves an after-midnight Out for a same-day evening shift in $language on $surface', async ({ language, surface, changeDates }) => {
    if (surface === 'mobile') {
      vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
        matches: query === '(max-width: 640px)', media: query, onchange: null,
        addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => false,
      }))
    }
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage(language)
    getAttendanceCase.mockResolvedValue({
      data: {
        ...CASE,
        scheduled_start_at: '2026-11-17T12:00:00Z',
        scheduled_end_at: '2026-11-17T19:00:00Z',
        effective: { presence_state: 'on_duty', first_in_at: '2026-11-17T12:00:00Z', final_out_at: null },
      },
      etag: 'case-v1',
    })
    const user = userEvent.setup()
    renderCorrection()
    await screen.findByLabelText(i18n.t('attendance.quickCorrection.inTime'))
    await user.type(screen.getByLabelText(new RegExp(i18n.t('attendance.quickCorrection.outTime').replace(/[()]/g, '\\$&'))), '00:10')
    await enterReason(user)
    expect(screen.getByRole('button', { name: i18n.t('attendance.quickCorrection.save') })).toBeDisabled()
    const disclosure = screen.getByRole('button', { name: changeDates })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    await user.click(disclosure)
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText(i18n.t('attendance.quickCorrection.inDate'))).toHaveValue('2026-11-17')
    await user.selectOptions(screen.getByLabelText(i18n.t('attendance.quickCorrection.outDate')), '2026-11-18')
    await user.click(screen.getByRole('button', { name: i18n.t('attendance.quickCorrection.save') }))
    await waitFor(() => expect(createAttendanceAdjustment).toHaveBeenCalledWith(42, 'case-v1', expect.objectContaining({
      replacement_presence_state: 'completed',
      replacement_first_in_at: '2026-11-17T12:00:00.000Z',
      replacement_final_out_at: '2026-11-17T20:10:00.000Z',
    })))
  })

  it.each(['desktop', 'mobile'] as const)('requires date choices for a new post-shift overnight arrival on %s', async (surface) => {
    if (surface === 'mobile') {
      vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
        matches: query === '(max-width: 640px)', media: query, onchange: null,
        addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => false,
      }))
    }
    getAttendanceCase.mockResolvedValue({
      data: {
        ...CASE,
        scheduled_start_at: '2026-11-17T18:00:00Z',
        scheduled_end_at: '2026-11-18T02:00:00Z',
        effective: { presence_state: 'unknown' },
      },
      etag: 'case-v1',
    })
    const user = userEvent.setup()
    renderCorrection()
    await user.type(await screen.findByLabelText('In time (24h)'), '06:10')
    await user.type(screen.getByLabelText(/Out time \(24h\)/), '06:30')
    await enterReason(user)
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled()
    const inDate = screen.getByLabelText('In date')
    const outDate = screen.getByLabelText('Out date')
    expect(inDate).toHaveValue('')
    expect(outDate).toHaveValue('')
    expect(within(inDate).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual(['', '2026-11-16', '2026-11-17', '2026-11-18'])
    await user.selectOptions(inDate, '2026-11-18')
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled()
    await user.selectOptions(outDate, '2026-11-18')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    await waitFor(() => expect(createAttendanceAdjustment).toHaveBeenCalledWith(42, 'case-v1', expect.objectContaining({
      replacement_first_in_at: '2026-11-18T02:10:00.000Z',
      replacement_final_out_at: '2026-11-18T02:30:00.000Z',
    })))
  })

  it.each([
    { language: 'en', surface: 'desktop' },
    { language: 'ar', surface: 'mobile' },
  ] as const)('prefills and saves effective next-day overnight dates in $language on $surface', async ({ language, surface }) => {
    if (surface === 'mobile') {
      vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
        matches: query === '(max-width: 640px)', media: query, onchange: null,
        addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => false,
      }))
    }
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage(language)
    getAttendanceCase.mockResolvedValue({
      data: {
        ...CASE,
        scheduled_start_at: '2026-11-17T18:00:00Z',
        scheduled_end_at: '2026-11-18T02:00:00Z',
        effective: {
          presence_state: 'completed',
          first_in_at: '2026-11-18T02:10:00Z',
          final_out_at: '2026-11-18T02:30:00Z',
        },
      },
      etag: 'case-v1',
    })
    const user = userEvent.setup()
    renderCorrection()
    expect(await screen.findByLabelText(i18n.t('attendance.quickCorrection.inTime'))).toHaveValue('06:10')
    const inDate = screen.getByLabelText(language === 'en' ? 'In date' : 'تاريخ الدخول')
    const outDate = screen.getByLabelText(language === 'en' ? 'Out date' : 'تاريخ الخروج')
    expect(inDate).toHaveValue('2026-11-18')
    expect(outDate).toHaveValue('2026-11-18')
    await enterReason(user)
    await user.click(screen.getByRole('button', { name: i18n.t('attendance.quickCorrection.save') }))
    await waitFor(() => expect(createAttendanceAdjustment).toHaveBeenCalledWith(42, 'case-v1', expect.objectContaining({
      replacement_first_in_at: '2026-11-18T02:10:00.000Z',
      replacement_final_out_at: '2026-11-18T02:30:00.000Z',
    })))
  })

  it('saves absent as a complete cleared snapshot with reason and audit note, refreshes every view, and announces success', async () => {
    const user = userEvent.setup()
    const { client, onClose } = renderCorrection()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await screen.findByLabelText('In time (24h)')
    await user.click(screen.getByRole('button', { name: 'Absent' }))
    expect(screen.queryByLabelText('In time (24h)')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled()
    await enterReason(user)
    await user.type(screen.getByLabelText(/Audit note/), 'Gate register 11')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    await waitFor(() => expect(createAttendanceAdjustment).toHaveBeenCalledWith(42, 'case-v1', {
      replacement_presence_state: 'absent',
      replacement_first_in_at: null,
      replacement_latest_in_at: null,
      replacement_final_out_at: null,
      replacement_late_minutes: null,
      replacement_early_exit_minutes: null,
      replacement_missing_checkout: null,
      reason: 'Supervisor confirmation: Confirmed by the post supervisor\nAudit note: Gate register 11',
    }))
    for (const queryKey of [
      ['attendance-case', 42], ['attendance-exceptions'], ['attendance-day'], ['employee-attendance'],
      ['workforce', 'snapshot'], ['workforce', 'coverage'], ['notification-counts'], ['attendance-punches'],
    ]) expect(invalidate).toHaveBeenCalledWith({ queryKey })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(successToast).toHaveBeenCalledWith('Correction saved. The day has been updated.')
    expect(screen.getByRole('status')).toHaveTextContent('Correction saved. The day has been updated.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('records the chosen leave subtype as audit text and discloses the model limitation', async () => {
    const user = userEvent.setup()
    const { onClose } = renderCorrection()
    await screen.findByLabelText('In time (24h)')
    await user.click(screen.getByRole('button', { name: 'On leave' }))
    expect(screen.getByText(/saved in the reason/)).toBeInTheDocument()
    expect(screen.getAllByRole('option').some((option) => /National Service|Passport|Permit/.test(option.textContent ?? ''))).toBe(false)
    await user.selectOptions(screen.getByLabelText('Leave subtype'), 'hajj')
    await enterReason(user, 'Approved leave HR-16')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    await waitFor(() => expect(createAttendanceAdjustment).toHaveBeenCalledWith(42, 'case-v1', expect.objectContaining({
      replacement_presence_state: 'excused_leave',
      replacement_first_in_at: null,
      reason: 'Supervisor confirmation: Approved leave HR-16\nLeave subtype: Hajj',
    })))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('offers Clear correction only for an active correction and revokes it with the case ETag', async () => {
    const user = userEvent.setup()
    const { onClose } = renderCorrection()
    await user.click(await screen.findByRole('button', { name: 'Clear correction' }))
    expect(screen.getByText(/Remove the active correction/)).toBeInTheDocument()
    await enterReason(user, 'Duplicate correction')
    await user.click(screen.getByRole('button', { name: 'Confirm clear correction' }))
    await waitFor(() => expect(revokeAttendanceAdjustment).toHaveBeenCalledWith(42, 4, 'case-v1', {
      reason: 'Supervisor confirmation: Duplicate correction',
    }))
    expect(createAttendanceAdjustment).not.toHaveBeenCalled()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('does not offer Clear correction for automatic evidence even when historic corrections exist', async () => {
    getAttendanceCase.mockResolvedValue({ data: { ...CASE, effective: { ...CASE.effective, adjustment_id: null } }, etag: 'case-v1' })
    renderCorrection()
    await screen.findByLabelText('In time (24h)')
    expect(screen.queryByRole('button', { name: /Clear correction/ })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Current evidence' })).toHaveTextContent('Automatic · system evaluation')
  })

  it('keeps the draft on conflict, shows refreshed current evidence, and never retries silently', async () => {
    const user = userEvent.setup()
    getAttendanceCase.mockResolvedValueOnce({ data: CASE, etag: 'case-v1' }).mockResolvedValue({
      data: { ...CASE, effective: { ...CASE.effective, first_in_at: '2026-11-17T03:50:00', late_minutes: 50 } }, etag: 'case-v2',
    })
    createAttendanceAdjustment.mockRejectedValueOnce(new ApiError(412, 'ATTENDANCE_CASE_VERSION_CONFLICT', 'Case changed'))
    const { onClose } = renderCorrection()
    const inTime = await screen.findByLabelText('In time (24h)')
    await user.clear(inTime)
    await user.type(inTime, '07:20')
    await enterReason(user, 'Retain my supervisor draft')
    await user.type(screen.getByLabelText(/Audit note/), 'Evidence 13')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Compare the refreshed evidence')
    await waitFor(() => expect(getAttendanceCase).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('In time (24h)')).toHaveValue('07:20')
    expect(screen.getByLabelText('Reason details')).toHaveValue('Retain my supervisor draft')
    expect(screen.getByLabelText(/Audit note/)).toHaveValue('Evidence 13')
    expect(screen.getByRole('region', { name: 'Current evidence' })).toHaveTextContent('2026-11-17 07:50')
    expect(createAttendanceAdjustment).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    await waitFor(() => expect(createAttendanceAdjustment).toHaveBeenLastCalledWith(42, 'case-v2', expect.objectContaining({
      replacement_first_in_at: '2026-11-17T03:20:00.000Z',
      reason: 'Supervisor confirmation: Retain my supervisor draft\nAudit note: Evidence 13',
    })))
  })

  it.each(['Escape', 'Close'] as const)('returns focus to the trigger after a pristine %s dismissal', async (method) => {
    const user = userEvent.setup()
    const { anchor, onClose } = renderCorrection()
    await screen.findByLabelText('In time (24h)')
    if (method === 'Escape') await user.keyboard('{Escape}')
    else await user.click(screen.getByRole('button', { name: 'Close correction' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    await waitFor(() => expect(anchor).toHaveFocus())
    expect(createAttendanceAdjustment).not.toHaveBeenCalled()
  })

  it('prompts before reload only while dirty and removes protection after reverting or discarding', async () => {
    const user = userEvent.setup()
    renderCorrection()
    await screen.findByLabelText('In time (24h)')
    const pristine = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(pristine)
    expect(pristine.defaultPrevented).toBe(false)
    const details = screen.getByLabelText('Reason details')
    await user.type(details, 'Unsaved gate register correction')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
    await user.clear(details)
    const reverted = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(reverted)
    expect(reverted.defaultPrevented).toBe(false)
    await user.type(details, 'Another unsaved correction')
    await user.click(screen.getByRole('button', { name: 'Close correction' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const discarded = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(discarded)
    expect(discarded.defaultPrevented).toBe(false)
  })

  it('asks Keep editing or Discard on dirty Escape and preserves the draft when editing continues', async () => {
    const user = userEvent.setup()
    const { onClose, anchor } = renderCorrection()
    await screen.findByLabelText('In time (24h)')
    await enterReason(user, 'Unsaved draft')
    await user.keyboard('{Escape}')
    const confirmation = await screen.findByRole('alertdialog')
    expect(within(confirmation).getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    expect(onClose).not.toHaveBeenCalled()
    await user.click(within(confirmation).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Reason details')).toHaveValue('Unsaved draft')
    await user.click(screen.getByRole('button', { name: 'Close correction' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    await waitFor(() => expect(anchor).toHaveFocus())
    expect(createAttendanceAdjustment).not.toHaveBeenCalled()
  })

  it('replaces the panel with evidence rather than saving or stacking it', async () => {
    const user = userEvent.setup()
    const { onViewEvidence } = renderCorrection()
    await screen.findByLabelText('In time (24h)')
    await user.click(screen.getByRole('button', { name: 'View evidence' }))
    expect(onViewEvidence).toHaveBeenCalledWith(42)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(createAttendanceAdjustment).not.toHaveBeenCalled()
  })

  it('renders a modal Arabic bottom sheet with isolated 24h inputs at the mobile breakpoint', async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(max-width: 640px)', media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => false,
    }))
    renderCorrection()
    const input = await screen.findByLabelText('وقت الدخول (24 ساعة)')
    expect(input).toHaveAttribute('dir', 'ltr')
    expect(screen.getByText('أحمد علي')).toBeInTheDocument()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('dir', 'rtl')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveClass('pb-[env(safe-area-inset-bottom)]')
    expect(screen.getByRole('button', { name: 'إغلاق التصحيح' })).toHaveClass('min-h-11')
  })

  it('does not expose the panel or load a case without the correction capability', () => {
    hasCapability.mockReturnValue(false)
    renderCorrection()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(getAttendanceCase).not.toHaveBeenCalled()
  })

  it('does not load a case when closed', () => {
    renderCorrection(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(getAttendanceCase).not.toHaveBeenCalled()
  })
})
