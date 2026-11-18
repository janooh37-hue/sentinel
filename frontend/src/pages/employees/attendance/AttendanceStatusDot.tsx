/**
 * One dot per person-day, coloured by `rowState()` and nothing else.
 *
 * Tokens follow the plan's status legend: National Service is `--smart`
 * (purple), every other excusing leave is `--info` (blue). The halo marks a
 * person on site right now and only ever sits on a present verdict.
 */

import { cn } from '@/lib/utils'

import type { RowState } from './attendanceModel'

/** `off` is the calendar's rest day: no case, so no verdict, but the legend names it. */
export type DotState = RowState | 'off'

const TONE: Record<DotState, string> = {
  verified: 'bg-success',
  grace: 'bg-caution',
  late: 'bg-warning',
  unpaired: 'bg-destructive',
  absent: 'bg-accent',
  leave: 'bg-info',
  national_service: 'bg-smart',
  pending: 'border-[1.5px] border-faint bg-transparent',
  off: 'bg-border-strong',
}

const HALO: Partial<Record<DotState, string>> = {
  verified: 'shadow-[0_0_0_3px_var(--success-soft)]',
  grace: 'shadow-[0_0_0_3px_var(--caution-soft)]',
  late: 'shadow-[0_0_0_3px_var(--warning-soft)]',
}

interface Props {
  state: DotState
  /** On site right now; ignored for any state that cannot be on site. */
  onSite?: boolean
  /**
   * An active human correction overlays the day: a `--primary` notch with a
   * `--surface` ring at the top inline-end corner (mirrors in RTL). The caller
   * names it in text ("Corrected") too; the notch is never the only signal.
   */
  corrected?: boolean
  /** Accessible name. Omit when visible text beside the dot already says it. */
  label?: string
  className?: string
}

const NOTCH =
  "relative after:absolute after:-end-[3px] after:-top-[3px] after:box-content after:h-[5px] after:w-[5px] after:rounded-[1px] after:border-[1.5px] after:border-surface after:bg-primary after:content-['']"

export function AttendanceStatusDot({ state, onSite = false, corrected = false, label, className }: Props): React.JSX.Element {
  const halo = onSite ? HALO[state] : undefined
  return (
    <i
      data-state={state}
      data-on-site={halo ? 'true' : undefined}
      data-corrected={corrected ? 'true' : undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      className={cn(
        'inline-block shrink-0',
        state === 'off' ? 'h-0.5 w-2 rounded-[1px]' : 'h-2.5 w-2.5 rounded-full',
        TONE[state],
        halo,
        corrected && NOTCH,
        className,
      )}
    />
  )
}
