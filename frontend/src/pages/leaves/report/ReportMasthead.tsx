/**
 * ReportMasthead — the "Annual Report" head: eyebrow line + hairline rule
 * with a mono "as of {date}" stamp at the inline-end and a pending-actions
 * chip (click = scope the table to Pending). The page h1 stays in
 * LeavesPage; this renders only the report-specific furniture.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { dateLocale } from './fmt'

interface ReportMastheadProps {
  year: number
  /** ISO `YYYY-MM-DD` (today). */
  today: string
  /** Distinct employees currently away (prototype "{n} on leave today"). */
  onLeaveTodayCount: number
  pendingCount: number
  /** True while the chip's Pending status filter is the active one. */
  pendingActive: boolean
  onPendingClick: () => void
  awaitingReturnCount: number
  /** True while the awaiting-return filter is active. */
  awaitingReturnActive: boolean
  onAwaitingReturnClick: () => void
  /** Informational only — leaves ending within the next ENDING_SOON_DAYS. */
  endingSoonCount: number
}

export function ReportMasthead({
  year,
  today,
  onLeaveTodayCount,
  pendingCount,
  pendingActive,
  onPendingClick,
  awaitingReturnCount,
  awaitingReturnActive,
  onAwaitingReturnClick,
  endingSoonCount,
}: ReportMastheadProps): React.JSX.Element {
  const { t, i18n } = useTranslation()

  // UTC-safe: split Y/M/D parts, format in UTC so the stamp never drifts a
  // day. dateLocale (day-first en-GB / ar-AE) — the page's date convention,
  // "as of 11 June 2026", not the en-US "June 11, 2026".
  const asOfDate = useMemo(() => {
    const [y, m, d] = today.slice(0, 10).split('-').map(Number)
    return new Intl.DateTimeFormat(dateLocale(i18n.language), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(y, m - 1, d)))
  }, [today, i18n.language])

  return (
    <header>
      <p className="text-[0.7em] font-semibold uppercase tracking-[0.14em] text-muted-foreground rtl:tracking-normal">
        {t('leaves.report.eyebrow', { year })}
      </p>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="flex-1 border-b border-border" aria-hidden="true" />
        <span className="whitespace-nowrap text-[0.75em] tabular-nums text-muted-foreground">
          {t('leaves.report.onLeaveToday', { n: onLeaveTodayCount })}
        </span>
        <span className="text-faint" aria-hidden="true">
          ·
        </span>
        <span className="whitespace-nowrap font-mono text-[0.75em] text-muted-foreground">
          {t('leaves.report.asOf', { date: asOfDate })}
        </span>
        {(pendingCount > 0 || pendingActive) && (
          <button
            type="button"
            aria-pressed={pendingActive}
            onClick={onPendingClick}
            className={cn(
              'rounded-full bg-warning-soft px-3 py-1 text-[0.75em] font-semibold tabular-nums text-warning transition-opacity hover:opacity-85 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              pendingActive && 'ring-1 ring-warning',
            )}
          >
            {t('leaves.report.pendingChip', { count: pendingCount })}
          </button>
        )}
        {(awaitingReturnCount > 0 || awaitingReturnActive) && (
          <button
            type="button"
            aria-pressed={awaitingReturnActive}
            onClick={onAwaitingReturnClick}
            className={cn(
              'rounded-full bg-warning-soft px-3 py-1 text-[0.75em] font-semibold tabular-nums text-warning transition-opacity hover:opacity-85 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              awaitingReturnActive && 'ring-1 ring-warning',
            )}
          >
            {t('leaves.report.awaitingReturnChip', { count: awaitingReturnCount })}
          </button>
        )}
        {endingSoonCount > 0 && (
          <span className="rounded-full bg-warning-soft/60 px-3 py-1 text-[0.75em] font-semibold tabular-nums text-warning/80">
            {t('leaves.report.endingSoonChip', { count: endingSoonCount })}
          </span>
        )}
      </div>
    </header>
  )
}
