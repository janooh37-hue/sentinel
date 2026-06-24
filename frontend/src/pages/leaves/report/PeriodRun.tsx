/**
 * PeriodRun — "02 Jun → 15 Jun" as a direction-aware run (prototype `.dr`).
 *
 * Each date is its own `<bdi dir="ltr">` (ar-AE emits Latin digits + Arabic
 * month names; isolation stops UAX#9 from reordering "02 يونيو"), but the RUN
 * ORDER follows the document direction: in RTL the start date renders at the
 * inline start (right) and the arrow flips to point at the end date — the
 * spec's "period arrows flip" / full-mirror contract. A single LTR-pinned
 * string would make Arabic readers meet the END date first.
 */
import { cn } from '@/lib/utils'

import { fmtDayMonth } from './fmt'

interface PeriodRunProps {
  start: string
  end: string
  locale: string
  className?: string
}

export function PeriodRun({ start, end, locale, className }: PeriodRunProps): React.JSX.Element {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap font-mono', className)}>
      <bdi dir="ltr">{fmtDayMonth(start, locale)}</bdi>
      <span aria-hidden="true" className="inline-block text-[0.85em] text-faint rtl:rotate-180">
        →
      </span>
      <bdi dir="ltr">{fmtDayMonth(end, locale)}</bdi>
    </span>
  )
}
