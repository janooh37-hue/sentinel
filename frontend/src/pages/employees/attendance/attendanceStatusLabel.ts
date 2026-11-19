/**
 * The words for a judged day, shared by every attendance surface.
 *
 * Colour comes from `rowState()` alone (see `AttendanceStatusDot`); this only
 * names the same verdict, adding the two facts a dot cannot carry: whether a
 * present person is still on site, and which leave excuses the day.
 */

import type { TFunction } from 'i18next'

import type { RowState } from './attendanceModel'

export interface StatusLabelFacts {
  /** On site right now (`isOnSiteNow`). */
  onSite?: boolean
  /** A departure is recorded (`outAt(row) !== null`). */
  hasOut?: boolean
  /** English half of the excusing leave type, from the API's `leave_label`. */
  leaveLabel?: string | null
  /** An active human correction overlays the day; the label says so in words. */
  corrected?: boolean
}

/** Leave subtype in the reader's language, or null when no translation exists. */
export function leaveSubtypeLabel(t: TFunction, leaveLabel: string): string | null {
  return t(`leaves.type.${leaveLabel}`, { defaultValue: '' }) || null
}

export function attendanceStatusLabel(t: TFunction, state: RowState, facts: StatusLabelFacts = {}): string {
  const verdict = verdictLabel(t, state, facts)
  return facts.corrected ? `${verdict} · ${t('attendance.state.corrected')}` : verdict
}

function verdictLabel(t: TFunction, state: RowState, facts: StatusLabelFacts): string {
  switch (state) {
    case 'national_service':
      return t('attendance.state.national_service')
    case 'leave': {
      const label = facts.leaveLabel?.trim()
      if (!label || label === 'National Service') return t('attendance.state.leave')
      if (label === 'Others') return t('attendance.state.leaveOther')
      const subtype = leaveSubtypeLabel(t, label)
      return subtype ? t('attendance.state.leaveWith', { subtype }) : t('attendance.state.leave')
    }
    case 'verified':
      if (facts.onSite) return t('attendance.state.onSite')
      return t(facts.hasOut ? 'attendance.state.left' : 'attendance.state.verified')
    case 'grace':
      return t('attendance.state.grace')
    case 'late':
      return t('attendance.state.late')
    case 'unpaired':
      return t('attendance.state.unpaired')
    case 'absent':
      return t('attendance.state.absent')
    case 'pending':
      return t('attendance.state.pending')
  }
}
