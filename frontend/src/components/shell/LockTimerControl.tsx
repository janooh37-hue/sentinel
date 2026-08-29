import { Minus, Plus, Timer } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  DEFAULT_IDLE_LOCK_SECONDS,
  LOCK_TIMER_OPTIONS,
} from '@/lib/useLockState'
import type { LockTimerSeconds } from '@/lib/useLockState'

interface LockTimerControlProps {
  value: number
  onChange: (value: LockTimerSeconds) => void
  disabled?: boolean
}

export function LockTimerControl({
  value,
  onChange,
  disabled = false,
}: LockTimerControlProps): React.JSX.Element {
  const { t } = useTranslation()
  const requestedIndex = LOCK_TIMER_OPTIONS.indexOf(value as LockTimerSeconds)
  const currentIndex = requestedIndex >= 0 ? requestedIndex : LOCK_TIMER_OPTIONS.length - 1
  const currentValue = LOCK_TIMER_OPTIONS[currentIndex] ?? DEFAULT_IDLE_LOCK_SECONDS
  const previousValue = LOCK_TIMER_OPTIONS[currentIndex - 1]
  const nextValue = LOCK_TIMER_OPTIONS[currentIndex + 1]

  return (
    <div
      className="flex min-h-[54px] w-full items-center gap-2.5 border-y border-hairline bg-surface-raised px-4 py-2.5"
      aria-busy={disabled}
    >
      <Timer
        className="h-4 w-4 shrink-0 text-muted-foreground"
        strokeWidth={1.7}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 text-start text-[0.9em] font-medium text-foreground">
        {t('lockTimer.title')}
      </span>
      <div className="grid shrink-0 grid-cols-[1.75rem_minmax(3.5rem,auto)_1.75rem] items-center overflow-hidden rounded-[10px] border border-border bg-surface">
        <button
          type="button"
          className="grid h-[30px] w-7 place-items-center text-primary transition-colors hover:bg-primary-soft focus-visible:z-10 focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--primary),inset_0_0_0_4px_var(--surface)] disabled:cursor-not-allowed disabled:text-faint disabled:opacity-60"
          aria-label={t('lockTimer.shorter')}
          disabled={disabled || previousValue === undefined}
          onClick={() => {
            if (previousValue !== undefined) onChange(previousValue)
          }}
        >
          <Minus className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        </button>
        <output
          role="status"
          aria-live="polite"
          className="min-w-14 border-x border-hairline px-1.5 text-center font-mono text-[0.68em] font-semibold leading-[30px] text-foreground"
        >
          {t(`lockTimer.options.${currentValue}`)}
        </output>
        <button
          type="button"
          className="grid h-[30px] w-7 place-items-center text-primary transition-colors hover:bg-primary-soft focus-visible:z-10 focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--primary),inset_0_0_0_4px_var(--surface)] disabled:cursor-not-allowed disabled:text-faint disabled:opacity-60"
          aria-label={t('lockTimer.longer')}
          disabled={disabled || nextValue === undefined}
          onClick={() => {
            if (nextValue !== undefined) onChange(nextValue)
          }}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
