import type { AttendanceAdjustmentWrite } from '@/lib/api'

export type AttendancePresenceState = NonNullable<AttendanceAdjustmentWrite['replacement_presence_state']>

export interface AttendanceEffective {
  presence_state: AttendancePresenceState | null
  first_in_at: string | null
  latest_in_at: string | null
  final_out_at: string | null
  late_minutes: number | null
  early_exit_minutes: number | null
  missing_checkout: boolean | null
}

export interface AttendanceCorrectionDraft {
  presenceState: AttendancePresenceState | null
  firstInAt: string
  latestInAt: string
  finalOutAt: string
  lateMinutes: string
  earlyExitMinutes: string
  missingCheckout: boolean | null
  reason: string
}

const DUBAI_INPUT_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dubai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function optionalMinutes(value: string): number | null {
  return value.trim() === '' ? null : Number.parseInt(value, 10)
}

function utcDate(value: string): Date {
  return new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`)
}

export function toLocalInput(value: string | null): string {
  if (value === null) return ''
  const parts = DUBAI_INPUT_FORMAT.formatToParts(utcDate(value))
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
}

export function localDubaiInputToUtc(value: string): string {
  return new Date(`${value}:00.000+04:00`).toISOString()
}

function optionalUtc(value: string): string | null {
  return value === '' ? null : localDubaiInputToUtc(value)
}

function retainedUtc(value: string | null): string | null {
  if (value === null || /[zZ]$|[+-]\d\d:\d\d$/.test(value)) return value
  return `${value}Z`
}

function snapshotUtc(draftValue: string, effectiveValue: string | null): string | null {
  return draftValue === toLocalInput(effectiveValue) ? retainedUtc(effectiveValue) : optionalUtc(draftValue)
}

export function draftFromEffective(effective: AttendanceEffective): AttendanceCorrectionDraft {
  return {
    presenceState: effective.presence_state,
    firstInAt: toLocalInput(effective.first_in_at),
    latestInAt: toLocalInput(effective.latest_in_at),
    finalOutAt: toLocalInput(effective.final_out_at),
    lateMinutes: effective.late_minutes === null ? '' : String(effective.late_minutes),
    earlyExitMinutes: effective.early_exit_minutes === null ? '' : String(effective.early_exit_minutes),
    missingCheckout: effective.missing_checkout,
    reason: '',
  }
}

export function buildAdjustmentPayload(
  effective: AttendanceEffective,
  draft: AttendanceCorrectionDraft,
): AttendanceAdjustmentWrite {
  const reason = draft.reason.trim()
  if (reason === '') throw new Error('CORRECTION_REASON_REQUIRED')
  const firstInAt = snapshotUtc(draft.firstInAt, effective.first_in_at)
  const latestInAt = snapshotUtc(draft.latestInAt, effective.latest_in_at)
  const finalOutAt = snapshotUtc(draft.finalOutAt, effective.final_out_at)
  const lateMinutes = optionalMinutes(draft.lateMinutes)
  const earlyExitMinutes = optionalMinutes(draft.earlyExitMinutes)
  if (
    draft.presenceState === effective.presence_state
    && draft.firstInAt === toLocalInput(effective.first_in_at)
    && draft.latestInAt === toLocalInput(effective.latest_in_at)
    && draft.finalOutAt === toLocalInput(effective.final_out_at)
    && lateMinutes === effective.late_minutes
    && earlyExitMinutes === effective.early_exit_minutes
    && draft.missingCheckout === effective.missing_checkout
  ) throw new Error('CORRECTION_UNCHANGED')
  return {
    reason,
    replacement_presence_state: draft.presenceState,
    replacement_first_in_at: firstInAt,
    replacement_latest_in_at: latestInAt,
    replacement_final_out_at: finalOutAt,
    replacement_late_minutes: lateMinutes,
    replacement_early_exit_minutes: earlyExitMinutes,
    replacement_missing_checkout: draft.missingCheckout,
  }
}
