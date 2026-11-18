import type { WorkforceAccess, WorkforceSnapshot } from '@/lib/api'
import { isOnSiteNow, outAt, rowState, type LeaveKind } from '@/pages/employees/attendance/attendanceModel'

const REASON_LEAVE_KINDS: Partial<Record<string, LeaveKind>> = {
  LEAVE_NATIONAL_SERVICE: 'national_service', LEAVE_SICK: 'sick',
  LEAVE_ANNUAL: 'annual', LEAVE_DUTY: 'duty', LEAVE_OTHER: 'other',
}
const LEAVE_LABELS: Record<LeaveKind, string> = {
  annual: 'Annual Leave', sick: 'Sick Leave', duty: 'Duty Leave', other: 'Others',
  national_service: 'National Service',
}

/** Adapt the snapshot's published facts, without inventing grace or lateness. */
export function selfAttendance(snapshot: WorkforceSnapshot) {
  const self = snapshot.self
  const leaveKind = self?.leave_kind ?? REASON_LEAVE_KINDS[self?.reason_code ?? ''] ?? null
  const punchCount = self?.first_punch_at
    ? self.last_punch_at && self.last_punch_at !== self.first_punch_at ? 2 : 1
    : 0
  const judged = {
    ...self,
    on_leave: self?.presence_state === 'excused_leave' || leaveKind !== null,
    leave_kind: leaveKind,
    punch_count: punchCount,
  }
  const now = new Date()
  const out = outAt(judged)
  const state = self?.presence_state === 'off' ? 'off' as const : rowState(judged, { now })
  const leaveLabel = leaveKind ? LEAVE_LABELS[leaveKind] : null
  return {
    state,
    out,
    leaveLabel,
    onSite: self?.presence_state === 'on_duty' && isOnSiteNow(judged, { now }),
  }
}

export type MissingReadiness = 'schedules' | 'policy' | 'mappings' | 'integration'

export type PulseState =
  | { kind: 'self'; snapshot: WorkforceSnapshot }
  | { kind: 'aggregate'; snapshot: WorkforceSnapshot }
  | { kind: 'no_scope' }
  | { kind: 'setup'; missing: MissingReadiness[] }
  | { kind: 'stale' }
  | { kind: 'withheld'; snapshot: WorkforceSnapshot }

export function derivePulseState(access: WorkforceAccess, snapshot: WorkforceSnapshot): PulseState {
  if (access.workforce_access_tier === 'none') return { kind: 'no_scope' }

  const missing: MissingReadiness[] = []
  if (snapshot.readiness) {
    if (!snapshot.readiness.schedules_ready) missing.push('schedules')
    if (!snapshot.readiness.policy_ready) missing.push('policy')
    if (!snapshot.readiness.mappings_ready) missing.push('mappings')
    if (!snapshot.readiness.integration_ready) missing.push('integration')
  }
  if (missing.length > 0) return { kind: 'setup', missing }
  if (snapshot.sync_health?.punches?.state === 'stale') return { kind: 'stale' }
  if (snapshot.current_shift.working == null && snapshot.current_shift.scheduled > 0) {
    return { kind: 'withheld', snapshot }
  }
  return snapshot.aggregate ? { kind: 'aggregate', snapshot } : { kind: 'self', snapshot }
}
