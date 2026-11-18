/**
 * The correction entry contract every attendance surface shares; the provider
 * and the button live in `AttendanceCorrectionEntry.tsx`.
 */

import { createContext, useContext } from 'react'

/** The person-day (one shift) a correction applies to. */
export interface CorrectionTarget {
  caseId: number
  employeeId: string
  /** Display name already picked for the reader's language. */
  employeeName: string
  /** `YYYY-MM-DD` operational date. */
  operationalDate: string
  shiftCode?: string | null
}

/** The active panel retains a requested navigation until its draft may be dismissed. */
export type CorrectionDismissalGuard = (proceed: () => void) => void

export interface AttendanceCorrectionContextValue {
  /** Null without `workforce.attendance.correct`: callers render no entry point. */
  openCorrection: ((target: CorrectionTarget, trigger: HTMLElement | null) => void) | null
  /** The full evidence drawer; reviewers without the correct capability read it too. */
  viewEvidence: (caseId: number) => void
  /** Defer navigation that leaves the active correction until its draft may be discarded. */
  requestNavigation: CorrectionDismissalGuard
  /** True while Quick correction or the evidence drawer is open: page shortcuts pause. */
  overlayOpen: boolean
}

export const AttendanceCorrectionContext = createContext<AttendanceCorrectionContextValue | null>(null)

const NO_PROVIDER: AttendanceCorrectionContextValue = {
  openCorrection: null,
  viewEvidence: () => undefined,
  requestNavigation: (proceed) => proceed(),
  overlayOpen: false,
}

export function useAttendanceCorrection(): AttendanceCorrectionContextValue {
  return useContext(AttendanceCorrectionContext) ?? NO_PROVIDER
}
