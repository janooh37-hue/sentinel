import { describe, expect, it } from 'vitest'

import type { AttendanceCase } from '@/lib/api'

import {
  buildQuickCorrectionPayload,
  buildQuickCorrectionReason,
  quickCorrectionDraftFromCase,
  quickCorrectionTimes,
  validateQuickCorrection,
  type QuickCorrectionDraft,
  type QuickCorrectionReasonLabels,
} from './quickCorrectionForm'

const attendanceCase: AttendanceCase = {
  id: 42,
  employee_id: 'G-9001',
  name_en: 'Ahmed Ali',
  operational_date: '2026-11-17',
  scheduled_start_at: '2026-11-17T03:00:00',
  scheduled_end_at: '2026-11-17T11:00:00',
  shift_code_snapshot: 'morning',
  organization_snapshot_state: 'assigned',
  effective: {
    presence_state: 'completed',
    first_in_at: '2026-11-17T03:10:00',
    latest_in_at: '2026-11-17T03:12:00',
    final_out_at: '2026-11-17T10:45:00',
    missing_checkout: false,
  },
}
const now = new Date('2026-11-18T07:40:00Z')
const labels: QuickCorrectionReasonLabels = {
  reason: 'Supervisor confirmation',
  leaveSubtype: 'Hajj',
  leaveSubtypeLabel: 'Leave subtype',
  auditNoteLabel: 'Audit note',
}
const draft: QuickCorrectionDraft = {
  action: 'present',
  inDate: '2026-11-17',
  outDate: '2026-11-17',
  inDateConfirmed: true,
  outDateConfirmed: true,
  inTime: '07:10',
  outTime: '14:45',
  leaveKind: 'hajj',
  reason: 'supervisor',
  details: ' Verified against the duty register ',
  auditNote: '',
}

const emptyTimes = {
  replacement_first_in_at: null,
  replacement_latest_in_at: null,
  replacement_final_out_at: null,
  replacement_late_minutes: null,
  replacement_early_exit_minutes: null,
  replacement_missing_checkout: null,
}

describe('quick correction snapshots', () => {
  it('prefills effective times in Dubai and never invents an Out from the schedule', () => {
    expect(quickCorrectionDraftFromCase(attendanceCase)).toMatchObject({
      action: 'present', inTime: '07:10', outTime: '14:45', reason: '', details: '',
    })
    expect(quickCorrectionDraftFromCase({
      ...attendanceCase,
      effective: { presence_state: 'on_duty', first_in_at: '2026-11-17T03:10:00' },
    }).outTime).toBe('')
    expect(quickCorrectionDraftFromCase({ ...attendanceCase, effective: { presence_state: 'absent' } }))
      .toMatchObject({ action: 'absent', inTime: '', outTime: '' })
    expect(quickCorrectionDraftFromCase({
      ...attendanceCase,
      effective: { presence_state: 'excused_leave', reason_code: 'LEAVE_SICK' },
    })).toMatchObject({ action: 'leave', leaveKind: 'sick' })
  })

  it('records a completed snapshot with minutes measured from the scheduled boundaries', () => {
    expect(buildQuickCorrectionPayload(attendanceCase, draft, labels, now)).toEqual({
      replacement_presence_state: 'completed',
      replacement_first_in_at: '2026-11-17T03:10:00.000Z',
      replacement_latest_in_at: '2026-11-17T03:10:00.000Z',
      replacement_final_out_at: '2026-11-17T10:45:00.000Z',
      replacement_late_minutes: 10,
      replacement_early_exit_minutes: 15,
      replacement_missing_checkout: false,
      reason: 'Supervisor confirmation: Verified against the duty register',
    })
  })

  it('clamps early arrivals and late departures to zero minutes', () => {
    expect(buildQuickCorrectionPayload(attendanceCase, {
      ...draft, inTime: '06:55', outTime: '15:05',
    }, labels, now)).toMatchObject({ replacement_late_minutes: 0, replacement_early_exit_minutes: 0 })
  })

  it('records on duty without an optional Out and clears the prior checkout', () => {
    expect(buildQuickCorrectionPayload(attendanceCase, { ...draft, outTime: '' }, labels, now)).toMatchObject({
      replacement_presence_state: 'on_duty',
      replacement_final_out_at: null,
      replacement_early_exit_minutes: null,
      replacement_missing_checkout: false,
    })
  })

  it('replaces absent values with null rather than retaining the previous punches', () => {
    expect(buildQuickCorrectionPayload(attendanceCase, { ...draft, action: 'absent' }, labels, now)).toEqual({
      ...emptyTimes,
      replacement_presence_state: 'absent',
      reason: 'Supervisor confirmation: Verified against the duty register',
    })
  })

  it('records the leave subtype and optional audit note in the reason, not an invented API field', () => {
    expect(buildQuickCorrectionPayload(attendanceCase, {
      ...draft, action: 'leave', auditNote: ' HR-16 ',
    }, labels, now)).toEqual({
      ...emptyTimes,
      replacement_presence_state: 'excused_leave',
      reason: 'Supervisor confirmation: Verified against the duty register\nLeave subtype: Hajj\nAudit note: HR-16',
    })
  })

  it('uses the following Dubai date for an overnight checkout', () => {
    const overnight = {
      ...attendanceCase,
      scheduled_start_at: '2026-11-17T18:00:00Z',
      scheduled_end_at: '2026-11-18T02:00:00Z',
    }
    expect(buildQuickCorrectionPayload(overnight, {
      ...draft, inTime: '22:10', outTime: '05:40', outDate: '2026-11-18',
    }, labels, now)).toMatchObject({
      replacement_first_in_at: '2026-11-17T18:10:00.000Z',
      replacement_final_out_at: '2026-11-18T01:40:00.000Z',
      replacement_late_minutes: 10,
      replacement_early_exit_minutes: 20,
    })
    expect(quickCorrectionTimes({ ...draft, inTime: '22:10', outTime: '05:40', outDate: '2026-11-18' }))
      .toMatchObject({ inDate: '2026-11-17', outDate: '2026-11-18' })
    expect(buildQuickCorrectionPayload(overnight, {
      ...draft, inTime: '00:10', outTime: '05:40', inDate: '2026-11-18', outDate: '2026-11-18',
    }, labels, now)).toMatchObject({
      replacement_first_in_at: '2026-11-17T20:10:00.000Z',
      replacement_final_out_at: '2026-11-18T01:40:00.000Z',
      replacement_late_minutes: 130,
    })
  })

  it('saves a next-day overnight arrival after the scheduled end on its selected date', () => {
    const overnight = {
      ...attendanceCase,
      scheduled_start_at: '2026-11-17T18:00:00Z',
      scheduled_end_at: '2026-11-18T02:00:00Z',
    }
    expect(buildQuickCorrectionPayload(overnight, {
      ...draft,
      inDate: '2026-11-18',
      outDate: '2026-11-18',
      inTime: '06:10',
      outTime: '06:30',
    }, labels, now)).toMatchObject({
      replacement_first_in_at: '2026-11-18T02:10:00.000Z',
      replacement_final_out_at: '2026-11-18T02:30:00.000Z',
      replacement_late_minutes: 490,
      replacement_early_exit_minutes: 0,
    })
  })

  it('preserves the effective next-day arrival date when prefilling an overnight correction', () => {
    const overnight = {
      ...attendanceCase,
      scheduled_start_at: '2026-11-17T18:00:00Z',
      scheduled_end_at: '2026-11-18T02:00:00Z',
      effective: {
        presence_state: 'completed',
        first_in_at: '2026-11-18T02:10:00Z',
        final_out_at: '2026-11-18T02:30:00Z',
      },
    }
    const prefilled = { ...quickCorrectionDraftFromCase(overnight), reason: draft.reason, details: draft.details }
    expect(buildQuickCorrectionPayload(overnight, prefilled, labels, now)).toMatchObject({
      replacement_first_in_at: '2026-11-18T02:10:00.000Z',
      replacement_final_out_at: '2026-11-18T02:30:00.000Z',
    })
    expect(prefilled).toMatchObject({
      inDate: '2026-11-18', outDate: '2026-11-18', inDateConfirmed: true, outDateConfirmed: true,
    })
  })

  it('requires an explicit date choice for new overnight In and Out times', () => {
    const overnight = {
      ...attendanceCase,
      scheduled_start_at: '2026-11-17T18:00:00Z',
      scheduled_end_at: '2026-11-18T02:00:00Z',
      effective: { presence_state: 'unknown' },
    }
    const entered = {
      ...quickCorrectionDraftFromCase(overnight),
      inTime: '06:10', outTime: '06:30', reason: draft.reason, details: draft.details,
    }
    expect(validateQuickCorrection(overnight, entered, now)).toBe('dateRequired')
    expect(validateQuickCorrection(overnight, { ...entered, inDate: '2026-11-18', inDateConfirmed: true }, now)).toBe('dateRequired')
    expect(validateQuickCorrection(overnight, {
      ...entered, inDate: '2026-11-18', outDate: '2026-11-18', inDateConfirmed: true, outDateConfirmed: true,
    }, now)).toBeNull()
    expect(entered).toMatchObject({ inDate: '2026-11-17', outDate: '2026-11-18' })
  })

  it.each([
    [{ inTime: '' }, 'inRequired'],
    [{ inTime: '24:05' }, 'invalidTime'],
    [{ inTime: '7:05' }, 'invalidTime'],
    [{ outTime: '15:60' }, 'invalidTime'],
    [{ outTime: '07:00' }, 'outBeforeIn'],
    [{ outTime: '07:10' }, 'outBeforeIn'],
  ] as const)('rejects invalid present times: %j', (change, error) => {
    expect(validateQuickCorrection(attendanceCase, { ...draft, ...change }, now)).toBe(error)
    expect(() => buildQuickCorrectionPayload(attendanceCase, { ...draft, ...change }, labels, now)).toThrow(error)
  })

  it('compares today’s wall-clock inputs with the current Dubai time, not the host timezone', () => {
    const today = {
      ...attendanceCase,
      operational_date: '2026-11-18',
      scheduled_start_at: '2026-11-18T03:00:00Z',
      scheduled_end_at: '2026-11-18T11:00:00Z',
    }
    expect(validateQuickCorrection(today, { ...draft, inDate: '2026-11-18', inTime: '11:41', outTime: '' }, now)).toBe('futureTime')
    expect(validateQuickCorrection(today, { ...draft, inDate: '2026-11-18', outDate: '2026-11-18', outTime: '11:41' }, now)).toBe('futureTime')
    expect(validateQuickCorrection(today, { ...draft, inDate: '2026-11-18', outDate: '2026-11-18', outTime: '11:40' }, now)).toBeNull()
  })

  it('also rejects a future next-day checkout for an overnight operational date', () => {
    const overnight = {
      ...attendanceCase,
      scheduled_start_at: '2026-11-17T18:00:00Z',
      scheduled_end_at: '2026-11-18T02:00:00Z',
    }
    expect(validateQuickCorrection(overnight, { ...draft, inTime: '22:10', outTime: '05:40', outDate: '2026-11-18' },
      new Date('2026-11-18T01:00:00Z'))).toBe('futureTime')
  })

  it('requires both a reason category and details for saving or clearing', () => {
    expect(validateQuickCorrection(attendanceCase, { ...draft, reason: '' }, now)).toBe('reasonRequired')
    expect(() => buildQuickCorrectionReason({ ...draft, details: '  ' }, labels)).toThrow('reasonRequired')
    expect(validateQuickCorrection(attendanceCase, { ...draft, action: 'clear' }, now)).toBe('clearUnavailable')
    expect(validateQuickCorrection({ ...attendanceCase, effective: { adjustment_id: 4 } }, {
      ...draft, action: 'clear',
    }, now)).toBeNull()
  })
})
