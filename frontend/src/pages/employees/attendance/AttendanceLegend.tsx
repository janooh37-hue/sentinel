/**
 * The status key shown on every attendance view and the employee month.
 *
 * A native `<details>`: open by default on wide screens, collapsed on a phone
 * where it would otherwise push the register below the fold.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { AttendanceStatusDot, type DotState } from './AttendanceStatusDot'

interface Entry {
  state: DotState
  onSite?: boolean
  corrected?: boolean
  labelKey: string
}

const ENTRIES: readonly Entry[] = [
  { state: 'verified', onSite: true, labelKey: 'attendance.state.onSite' },
  { state: 'verified', labelKey: 'attendance.state.left' },
  { state: 'grace', labelKey: 'attendance.state.grace' },
  { state: 'late', labelKey: 'attendance.state.late' },
  { state: 'unpaired', labelKey: 'attendance.state.unpaired' },
  { state: 'absent', labelKey: 'attendance.state.absent' },
  { state: 'pending', labelKey: 'attendance.state.pending' },
  { state: 'off', labelKey: 'attendance.state.off' },
  { state: 'leave', labelKey: 'attendance.state.leave' },
  { state: 'national_service', labelKey: 'attendance.state.national_service' },
  { state: 'verified', corrected: true, labelKey: 'attendance.state.corrected' },
]

interface Props {
  /** Include the rest-day dash; only the month calendar shows days without a duty. */
  showOff?: boolean
  className?: string
}

function startsOpen(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? true
    : window.matchMedia('(min-width: 641px)').matches
}

export function AttendanceLegend({ showOff = false, className }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [open] = useState(startsOpen)
  const entries = showOff ? ENTRIES : ENTRIES.filter((entry) => entry.state !== 'off')
  return (
    <details
      open={open}
      data-testid="attendance-legend"
      data-print-hide
      className={cn('text-[0.75em] text-muted-foreground', className)}
    >
      <summary className="min-h-11 cursor-pointer py-2 sm:min-h-7 sm:py-1">
        <span className="font-semibold text-foreground">{t('attendance.legend.title')}</span>
        <span className="ms-1.5">· {t('attendance.legend.hint')}</span>
      </summary>
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1 pt-1.5">
        {entries.map((entry) => (
          <li key={entry.labelKey} className="inline-flex items-center gap-2 whitespace-nowrap">
            <AttendanceStatusDot state={entry.state} onSite={entry.onSite} corrected={entry.corrected} />
            {t(entry.labelKey)}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[0.92em]">{t('attendance.legend.details')}</p>
    </details>
  )
}
