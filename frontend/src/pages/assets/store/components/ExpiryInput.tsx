/**
 * ExpiryInput — a Batch expiry as a full date, a month only (stored as that
 * month's last day), or "no expiry" (the item's one undated Batch). The mode
 * is a three-way segmented choice so the state reads from text, not colour.
 */

import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import type { ExpiryMode, ExpiryValue } from '../storeUtils'

const MODES: readonly ExpiryMode[] = ['date', 'month', 'none']

interface Props {
  id: string
  value: ExpiryValue
  onChange: (next: ExpiryValue) => void
  invalid?: boolean
  describedBy?: string
  disabled?: boolean
  allowUndated?: boolean
}

export function ExpiryInput({
  id,
  value,
  onChange,
  invalid = false,
  describedBy,
  disabled = false,
  allowUndated = true,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div
        role="radiogroup"
        aria-label={t('assets.store.expiryInput.modeAria')}
        className={cn('grid gap-1 rounded-lg border border-border bg-surface p-1', allowUndated ? 'grid-cols-3' : 'grid-cols-2')}
        onKeyDown={(event) => {
          if (disabled) return
          const modes = MODES.filter((mode) => allowUndated || mode !== 'none')
          const index = modes.indexOf(value.mode)
          const direction = getComputedStyle(event.currentTarget).direction
            || event.currentTarget.closest('[dir]')?.getAttribute('dir')
          let step = 0
          if (event.key === 'ArrowRight') step = direction === 'rtl' ? -1 : 1
          if (event.key === 'ArrowLeft') step = direction === 'rtl' ? 1 : -1
          if (event.key === 'ArrowDown') step = 1
          if (event.key === 'ArrowUp') step = -1
          if (!step) return
          event.preventDefault()
          const next = (index + step + modes.length) % modes.length
          onChange({ ...value, mode: modes[next] })
          event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="radio"]')[next]?.focus()
        }}
      >
        {MODES.filter((mode) => allowUndated || mode !== 'none').map((mode) => (
          <label
            key={mode}
            className="relative flex min-h-11 cursor-pointer items-center justify-center"
          >
            <input
              type="radio"
              name={`${id}-mode`}
              value={mode}
              checked={value.mode === mode}
              tabIndex={value.mode === mode ? 0 : -1}
              disabled={disabled}
              onChange={() => onChange({ ...value, mode })}
              className="peer sr-only"
            />
            <span
              className={cn(
                'flex min-h-11 w-full items-center justify-center rounded-md px-2 text-[0.8em] font-medium transition-colors motion-reduce:transition-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
                value.mode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-surface-tinted',
              )}
            >
              {value.mode === mode && <Check aria-hidden className="me-1 h-3.5 w-3.5 shrink-0" />}
              {t(`assets.store.expiryInput.${mode}`)}
            </span>
          </label>
        ))}
      </div>
      {value.mode === 'date' && (
        <Input
          id={id}
          type="date"
          dir="ltr"
          aria-label={t('assets.store.expiryInput.dateAria')}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          value={value.date}
          onChange={(event) => onChange({ ...value, date: event.target.value })}
          className="h-11 font-mono tabular-nums"
        />
      )}
      {value.mode === 'month' && (
        <Input
          id={id}
          type="month"
          dir="ltr"
          placeholder={t('assets.store.expiryInput.monthPlaceholder')}
          aria-label={t('assets.store.expiryInput.monthAria')}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          value={value.month}
          onChange={(event) => onChange({ ...value, month: event.target.value })}
          className="h-11 font-mono tabular-nums"
        />
      )}
      {value.mode === 'none' && (
        <p id={id} className="text-[0.78em] text-muted-foreground">
          {t('assets.store.expiryInput.noneHint')}
        </p>
      )}
    </div>
  )
}
