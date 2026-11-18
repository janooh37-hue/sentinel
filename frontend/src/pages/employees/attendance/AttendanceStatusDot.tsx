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
  /** Accessible name. Omit when visible text beside the dot already says it. */
  label?: string
  className?: string
}

export function AttendanceStatusDot({ state, onSite = false, label, className }: Props): React.JSX.Element {
  const halo = onSite ? HALO[state] : undefined
  return (
    <i
      data-state={state}
      data-on-site={halo ? 'true' : undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      className={cn(
        'inline-block shrink-0',
        state === 'off' ? 'h-0.5 w-2 rounded-[1px]' : 'h-2.5 w-2.5 rounded-full',
        TONE[state],
        halo,
        className,
      )}
    />
  )
}
