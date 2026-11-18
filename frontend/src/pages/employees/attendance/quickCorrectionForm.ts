import type { AttendanceAdjustmentWrite, AttendanceCase } from '@/lib/api'

import { localDubaiInputToUtc, toLocalInput, utcDate } from './attendanceCorrectionForm'

export const QUICK_CORRECTION_REASONS = ['device', 'supervisor', 'leave', 'roster', 'other'] as const
export const QUICK_CORRECTION_LEAVE_KINDS = [
  'annual', 'sick', 'duty', 'compassionate', 'emergency', 'hajj', 'administrative', 'other',
] as const

export type QuickCorrectionAction = 'present' | 'absent' | 'leave' | 'clear'
export type QuickCorrectionReason = typeof QUICK_CORRECTION_REASONS[number]
export type QuickCorrectionLeaveKind = typeof QUICK_CORRECTION_LEAVE_KINDS[number]

export interface QuickCorrectionDraft {
  action: QuickCorrectionAction
  inDate: string
  outDate: string
  inDateConfirmed: boolean
  outDateConfirmed: boolean
  inTime: string
  outTime: string
  leaveKind: QuickCorrectionLeaveKind
  reason: QuickCorrectionReason | ''
  details: string
  auditNote: string
}

/** Labels are supplied in the operator's language; the audit stores the displayed choices. */
export interface QuickCorrectionReasonLabels {
  reason: string
  leaveSubtype: string
  leaveSubtypeLabel: string
  auditNoteLabel: string
}

export type QuickCorrectionError = 'reasonRequired' | 'inRequired' | 'dateRequired' | 'invalidTime' | 'outBeforeIn'
  | 'futureTime' | 'clearUnavailable'

type QuickCorrectionCase = Pick<AttendanceCase,
  'operational_date' | 'scheduled_start_at' | 'scheduled_end_at' | 'effective'>

export function quickCorrectionDraftFromCase(attendanceCase: QuickCorrectionCase): QuickCorrectionDraft {
  const effective = attendanceCase.effective
  const reasonCode = typeof effective?.reason_code === 'string' ? effective.reason_code.toLowerCase() : ''
  const leaveKind = QUICK_CORRECTION_LEAVE_KINDS.find((kind) =>
    kind === effective?.leave_kind || reasonCode === `leave_${kind}`,
  ) ?? 'annual'
  const startDate = toLocalInput(attendanceCase.scheduled_start_at).slice(0, 10)
  const endDate = toLocalInput(attendanceCase.scheduled_end_at).slice(0, 10)
  const firstIn = typeof effective?.first_in_at === 'string' ? toLocalInput(effective.first_in_at) : ''
  const finalOut = typeof effective?.final_out_at === 'string' ? toLocalInput(effective.final_out_at) : ''
  return {
    action: effective?.presence_state === 'absent' ? 'absent'
      : effective?.presence_state === 'excused_leave' ? 'leave' : 'present',
    inDate: firstIn.slice(0, 10) || startDate,
    outDate: finalOut.slice(0, 10) || endDate,
    inDateConfirmed: firstIn !== '' || startDate === endDate,
    outDateConfirmed: finalOut !== '' || startDate === endDate,
    inTime: firstIn.slice(11),
    outTime: finalOut.slice(11),
    leaveKind,
    reason: '',
    details: '',
    auditNote: '',
  }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** Convert explicitly selected Dubai dates and wall times without guessing a rollover. */
export function quickCorrectionTimes(draft: QuickCorrectionDraft): {
  firstInAt: string
  finalOutAt: string | null
  inDate: string
  outDate: string | null
} {
  if (draft.inTime === '') throw new Error('inRequired')
  if (!TIME.test(draft.inTime) || (draft.outTime !== '' && !TIME.test(draft.outTime))) {
    throw new Error('invalidTime')
  }
  if (!draft.inDateConfirmed || draft.inDate === ''
    || (draft.outTime !== '' && (!draft.outDateConfirmed || draft.outDate === ''))) {
    throw new Error('dateRequired')
  }
  const inDate = draft.inDate
  const firstInAt = localDubaiInputToUtc(`${inDate}T${draft.inTime}`)
  let outDate: string | null = null
  let finalOutAt: string | null = null
  if (draft.outTime !== '') {
    outDate = draft.outDate
    finalOutAt = localDubaiInputToUtc(`${outDate}T${draft.outTime}`)
    if (Date.parse(finalOutAt) <= Date.parse(firstInAt)) throw new Error('outBeforeIn')
  }
  return { firstInAt, finalOutAt, inDate, outDate }
}

export function validateQuickCorrection(
  attendanceCase: QuickCorrectionCase,
  draft: QuickCorrectionDraft,
  now: Date,
): QuickCorrectionError | null {
  if (draft.reason === '' || draft.details.trim() === '') return 'reasonRequired'
  if (draft.action === 'clear') {
    return typeof attendanceCase.effective?.adjustment_id === 'number' ? null : 'clearUnavailable'
  }
  if (draft.action !== 'present') return null
  try {
    const times = quickCorrectionTimes(draft)
    if (Date.parse(times.firstInAt) > now.getTime()
      || (times.finalOutAt !== null && Date.parse(times.finalOutAt) > now.getTime())) return 'futureTime'
  } catch (error) {
    if (error instanceof Error && error.message === 'inRequired') return 'inRequired'
    if (error instanceof Error && error.message === 'dateRequired') return 'dateRequired'
    if (error instanceof Error && error.message === 'outBeforeIn') return 'outBeforeIn'
    return 'invalidTime'
  }
  return null
}

export function buildQuickCorrectionReason(draft: QuickCorrectionDraft, labels: QuickCorrectionReasonLabels): string {
  if (draft.reason === '' || draft.details.trim() === '') throw new Error('reasonRequired')
  const lines = [`${labels.reason}: ${draft.details.trim()}`]
  // Leave subtype has no structured field on the correction API. Preserve it explicitly in the audit reason.
  if (draft.action === 'leave') lines.push(`${labels.leaveSubtypeLabel}: ${labels.leaveSubtype}`)
  if (draft.auditNote.trim() !== '') lines.push(`${labels.auditNoteLabel}: ${draft.auditNote.trim()}`)
  return lines.join('\n')
}

/** The correction API takes a complete snapshot: absent/leave must clear all prior punch-derived values. */
export function buildQuickCorrectionPayload(
  attendanceCase: QuickCorrectionCase,
  draft: QuickCorrectionDraft,
  labels: QuickCorrectionReasonLabels,
  now: Date,
): AttendanceAdjustmentWrite {
  const error = validateQuickCorrection(attendanceCase, draft, now)
  if (error !== null) throw new Error(error)
  if (draft.action === 'clear') throw new Error('clearUnavailable')
  const reason = buildQuickCorrectionReason(draft, labels)
  if (draft.action !== 'present') {
    return {
      replacement_presence_state: draft.action === 'absent' ? 'absent' : 'excused_leave',
      replacement_first_in_at: null,
      replacement_latest_in_at: null,
      replacement_final_out_at: null,
      replacement_late_minutes: null,
      replacement_early_exit_minutes: null,
      replacement_missing_checkout: null,
      reason,
    }
  }
  const { firstInAt, finalOutAt } = quickCorrectionTimes(draft)
  return {
    replacement_presence_state: finalOutAt === null ? 'on_duty' : 'completed',
    replacement_first_in_at: firstInAt,
    replacement_latest_in_at: firstInAt,
    replacement_final_out_at: finalOutAt,
    replacement_late_minutes: Math.max(0,
      Math.floor((Date.parse(firstInAt) - utcDate(attendanceCase.scheduled_start_at).getTime()) / 60_000)),
    replacement_early_exit_minutes: finalOutAt === null ? null : Math.max(0,
      Math.floor((utcDate(attendanceCase.scheduled_end_at).getTime() - Date.parse(finalOutAt)) / 60_000)),
    replacement_missing_checkout: false,
    reason,
  }
}
