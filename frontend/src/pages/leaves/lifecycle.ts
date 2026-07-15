/**
 * Per-kind leave lifecycle — the frontend mirror of
 * backend/app/core/leave_lifecycle.py. Single source of truth for display
 * states, available actions, needs-action, and day counting. Consumed by the
 * desktop report AND mobile TabRecords; do not fork these rules per surface.
 *
 * Stored vocabulary: Pending, Approved, Rejected, Cancelled, Completed
 * ('Generated' is retired by the 0035 data migration but defensively aliased
 * here).
 */
import { englishPart } from '@/lib/bilingualValue'

import { classifyLeaveType } from './report/kinds'

export type LifecycleGroup = 'sick' | 'request' | 'record' | 'ns'
export type DisplayState =
  | 'Recorded' | 'Requested' | 'Confirmed' | 'PreApproved'
  | 'Scheduled' | 'AwaitingCertificate' | 'AwaitingReturn' | 'Completed'
  | 'Rejected' | 'Cancelled' | 'Unknown'
export type LeaveAction = 'approve' | 'reject' | 'cancel' | 'delay' | 'extend' | 'certificate' | 'return' | 'amend'

export const ENDING_SOON_DAYS = 3

/** Kinds with no workflow at all — born Approved, register entries only.
 * Mirrors backend _RECORD_TYPES; Passport Release / Duty Resumption bucket to
 * Others for FILTER chips but must not get request actions/counting. */
const RECORD_TYPES: ReadonlySet<string> = new Set([
  'administrative leave', 'leave permit', 'passport release', 'duty resumption',
])

/** The only request-group kind that closes out with a Duty Resumption.
 * v3 rows sometimes stored the bare word 'Annual'. */
const ANNUAL: ReadonlySet<string> = new Set(['annual leave', 'annual'])

export function canonStatus(raw: string): string {
  const s = englishPart(raw).trim()
  return s === 'Generated' ? 'Approved' : s
}

export function lifecycleGroup(leaveType: string): LifecycleGroup {
  if (RECORD_TYPES.has(englishPart(leaveType).trim().toLowerCase())) return 'record'
  const kind = classifyLeaveType(leaveType)
  if (kind === 'Sick Leave') return 'sick'
  if (kind === 'National Service') return 'ns'
  return 'request'
}

/** Kinds that close out with a Duty Resumption (return) form: only Annual Leave
 * and National Service. Every other request-group kind is terminal once
 * Approved. Mirrors leave_lifecycle.is_returnable. */
export function isReturnable(leaveType: string): boolean {
  if (ANNUAL.has(englishPart(leaveType).trim().toLowerCase())) return true
  return lifecycleGroup(leaveType) === 'ns'
}

/** end-date inclusive: an NS row is overdue strictly after its last day. */
function isOverdue(endDate: string, todayIso: string): boolean {
  return endDate.slice(0, 10) < todayIso
}

export function displayState(
  leaveType: string, status: string, endDate: string, todayIso: string,
  hasCertificate = false,
): DisplayState {
  const s = canonStatus(status)
  if (s === 'Rejected') return 'Rejected'
  if (s === 'Cancelled') return 'Cancelled'
  const group = lifecycleGroup(leaveType)
  switch (group) {
    case 'sick':
      return 'Recorded'
    case 'record':
      return classifyLeaveType(leaveType) === 'Administrative Leave' ? 'PreApproved' : 'Recorded'
    case 'ns':
      if (s === 'Completed') return 'Completed'
      if (s === 'Pending') {
        if (!isOverdue(endDate, todayIso)) return 'Scheduled'
        return hasCertificate ? 'AwaitingReturn' : 'AwaitingCertificate'
      }
      return 'Unknown'
    case 'request':
      if (s === 'Pending') return 'Requested'
      if (s === 'Completed') return 'Confirmed'
      if (s === 'Approved') {
        // Only returnable kinds (Annual) await a return; others are terminal.
        return isReturnable(leaveType) && isOverdue(endDate, todayIso)
          ? 'AwaitingReturn' : 'Confirmed'
      }
      return 'Unknown'
  }
}

export function actionsFor(
  leaveType: string, status: string, endDate: string, todayIso: string,
  hasCertificate = false,
): LeaveAction[] {
  const s = canonStatus(status)
  const group = lifecycleGroup(leaveType)
  if (group === 'request') {
    if (s === 'Pending') return ['approve', 'reject', 'cancel']
    if (s === 'Approved') {
      const acts: LeaveAction[] = isReturnable(leaveType) && isOverdue(endDate, todayIso)
        ? ['return', 'cancel'] : ['cancel']
      // Post-approval amendment: Annual only (mirrors backend can_amend).
      if (isReturnable(leaveType) && lifecycleGroup(leaveType) === 'request') acts.unshift('amend')
      return acts
    }
    return []
  }
  if (group === 'ns') {
    if (s === 'Pending') {
      const overdue = isOverdue(endDate, todayIso)
      const third: LeaveAction = overdue && hasCertificate ? 'return' : 'certificate'
      return ['delay', 'extend', third, 'cancel']
    }
    return []
  }
  return []
}

export function needsAction(
  leaveType: string, status: string, endDate: string, todayIso: string,
): boolean {
  const s = canonStatus(status)
  const group = lifecycleGroup(leaveType)
  if (group === 'request') {
    if (s === 'Pending') return true
    // Only returnable kinds (Annual) await a return; others are terminal.
    if (s === 'Approved') return isReturnable(leaveType) && isOverdue(endDate, todayIso)
    return false
  }
  if (group === 'ns') return s === 'Pending' && isOverdue(endDate, todayIso)
  return false
}

/** Do this row's days count as leave days (figures, balance-style sums)? */
export function countsDays(leaveType: string, status: string): boolean {
  const group = lifecycleGroup(leaveType)
  if (group === 'record' || group === 'ns') return false
  const s = canonStatus(status)
  return s !== 'Rejected' && s !== 'Cancelled'
}

/** Heads-up: a returnable leave in its active phase ending within ENDING_SOON_DAYS. */
export function endingSoon(
  leaveType: string, status: string, endDate: string, todayIso: string,
): boolean {
  const group = lifecycleGroup(leaveType)
  const s = canonStatus(status)
  const active =
    (group === 'request' && s === 'Approved' && isReturnable(leaveType)) ||
    (group === 'ns' && s === 'Pending')
  if (!active) return false
  const end = endDate.slice(0, 10)
  if (end < todayIso) return false
  const [ey, em, ed] = end.split('-').map(Number)
  const [ty, tm, td] = todayIso.split('-').map(Number)
  const delta = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(ty, tm - 1, td)) / 86_400_000)
  return delta >= 0 && delta <= ENDING_SOON_DAYS
}
