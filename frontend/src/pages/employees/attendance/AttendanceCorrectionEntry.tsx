/**
 * One way into the audited attendance correction, from every surface.
 *
 * Register rows, Board tiles, Timeline rows, the attention queue and the
 * employee month all render `CorrectAttendanceButton`; the provider owns the
 * single Quick correction overlay and the evidence drawer behind it. Without
 * `workforce.attendance.correct` the button renders nothing (never disabled),
 * and the evidence drawer stays available to reviewers.
 */

import { PencilLine } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'
import { ATTENDANCE_CORRECT_CAP } from '@/lib/workforceAttendance'

import { AttendanceCorrectionDrawer } from './AttendanceCorrectionDrawer'
import { QuickCorrection } from './QuickCorrection'
import {
  AttendanceCorrectionContext,
  useAttendanceCorrection,
  type AttendanceCorrectionContextValue,
  type CorrectionTarget,
  type CorrectionDismissalGuard,
} from './attendanceCorrectionContext'

interface OpenCorrection {
  target: CorrectionTarget
  trigger: HTMLElement | null
}

export function AttendanceCorrectionProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { has } = useCapabilities()
  const canCorrect = has(ATTENDANCE_CORRECT_CAP)
  const [current, setCurrent] = useState<OpenCorrection | null>(null)
  const [evidenceCaseId, setEvidenceCaseId] = useState<number | null>(null)
  const dismissalGuard = useRef<CorrectionDismissalGuard | null>(null)
  const registerDismissalGuard = useCallback((guard: CorrectionDismissalGuard | null) => {
    dismissalGuard.current = guard
  }, [])

  const openCorrection = useCallback((target: CorrectionTarget, trigger: HTMLElement | null) => {
    if (current?.target.caseId === target.caseId) return
    const proceed = (): void => {
      setEvidenceCaseId(null)
      setCurrent({ target, trigger })
    }
    if (dismissalGuard.current) dismissalGuard.current(proceed)
    else proceed()
  }, [current])
  const showEvidence = useCallback((caseId: number) => {
    // One overlay at a time: evidence replaces Quick correction, never stacks on it.
    setCurrent(null)
    setEvidenceCaseId(caseId)
  }, [])
  const viewEvidence = useCallback((caseId: number) => {
    const proceed = (): void => showEvidence(caseId)
    if (dismissalGuard.current) dismissalGuard.current(proceed)
    else proceed()
  }, [showEvidence])

  const value = useMemo<AttendanceCorrectionContextValue>(
    () => ({
      openCorrection: canCorrect ? openCorrection : null,
      viewEvidence,
      overlayOpen: current !== null || evidenceCaseId !== null,
    }),
    [canCorrect, current, evidenceCaseId, openCorrection, viewEvidence],
  )

  return (
    <AttendanceCorrectionContext.Provider value={value}>
      {children}
      {canCorrect && (
        <QuickCorrection
          target={current?.target ?? null}
          anchor={current?.trigger ?? null}
          onClose={() => setCurrent(null)}
          onViewEvidence={showEvidence}
          onDismissalGuardChange={registerDismissalGuard}
        />
      )}
      <AttendanceCorrectionDrawer caseId={evidenceCaseId} onClose={() => setEvidenceCaseId(null)} />
    </AttendanceCorrectionContext.Provider>
  )
}

interface ButtonProps {
  target: CorrectionTarget
  /** `icon`: a compact 44px-on-touch pencil; `text`: pencil plus the visible action name. */
  variant?: 'icon' | 'text'
  className?: string
}

export function CorrectAttendanceButton({ target, variant = 'icon', className }: ButtonProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { openCorrection } = useAttendanceCorrection()
  if (!openCorrection) return null
  // Two shifts on one day are two corrections: the shift keeps their names apart.
  const name = target.shiftCode
    ? t('attendance.correct.actionForShift', {
      name: target.employeeName,
      date: target.operationalDate,
      shift: t(`attendance.shift.${target.shiftCode}`, { defaultValue: target.shiftCode }),
    })
    : t('attendance.correct.actionFor', { name: target.employeeName, date: target.operationalDate })
  return (
    <button
      type="button"
      data-testid="attendance-correct-trigger"
      data-attendance-correction-trigger=""
      aria-label={name}
      title={name}
      aria-haspopup="dialog"
      onClick={(event) => {
        event.stopPropagation()
        openCorrection(target, event.currentTarget)
      }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        variant === 'icon' ? 'h-11 w-11 sm:h-7 sm:w-7' : 'min-h-11 px-2.5 text-[0.8em] font-semibold sm:min-h-8',
        className,
      )}
    >
      <PencilLine aria-hidden className="h-3.5 w-3.5" />
      {variant === 'text' && <span>{t('attendance.correct.action')}</span>}
    </button>
  )
}
