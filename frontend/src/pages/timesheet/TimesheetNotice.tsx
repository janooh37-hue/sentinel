/**
 * One line for everything wrong with the month, and everyone who moved.
 *
 * Each count is a button that opens the checks panel, because a number the
 * operator cannot act on is decoration. Every chip pairs its count with its own
 * words, so the level survives greyscale (UI spec §6, "status / count chips").
 *
 * The counts come from the grid response, never from a join against `rows`: the
 * server recomputes `warnings` live even on a sealed month, so an issue can name
 * someone with no row in the same payload.
 */

import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

type ChipTone = 'ok' | 'warn' | 'stop' | 'info'

const TONE_CLASS: Record<ChipTone, string> = {
  ok: 'bg-success-soft text-success',
  warn: 'bg-warning-soft text-warning',
  stop: 'bg-accent-soft text-accent',
  info: 'bg-primary-soft text-primary',
}

export interface TimesheetNoticeProps {
  blocking: number
  warnings: number
  joined: number
  leaving: number
  removed: number
  onOpenChecks: () => void
}

export function TimesheetNotice({
  blocking,
  warnings,
  joined,
  leaving,
  removed,
  onOpenChecks,
}: TimesheetNoticeProps): React.JSX.Element {
  const { t } = useTranslation()

  const chip = (tone: ChipTone, count: number | null, text: string) => (
    <button
      key={text}
      type="button"
      onClick={onOpenChecks}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.72em] font-semibold transition-[filter]',
        'hover:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        TONE_CLASS[tone],
      )}
    >
      {count !== null && (
        // A bare numeral beside Arabic words: isolate the leaf so bidi cannot
        // move it to the far end of the chip (UI spec §14).
        <span dir="ltr" className="font-mono tabular-nums [unicode-bidi:isolate]">
          {count}
        </span>
      )}
      {text}
    </button>
  )

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5">
      <span
        data-ts-caps
        className="shrink-0 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-faint"
      >
        {t('timesheet.thisMonth')}
      </span>
      {blocking > 0
        ? chip('stop', blocking, t('timesheet.blocking'))
        : chip('ok', null, `✓ ${t('timesheet.allClear')}`)}
      {warnings > 0 && chip('warn', warnings, t('timesheet.warning'))}
      {joined > 0 && chip('warn', joined, t('timesheet.startingPoint'))}
      {leaving > 0 && chip('stop', leaving, t('timesheet.leaving'))}
      {removed > 0 && chip('info', removed, t('timesheet.removedFromSheet'))}
    </div>
  )
}
