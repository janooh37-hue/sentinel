/**
 * ExpiryInput — a Batch expiry as a full date, a month only (stored as that
 * month's last day), or "no expiry" (the item's one undated Batch). The mode
 * is a three-way segmented choice so the state reads from text, not colour.
 */

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
        className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface p-1"
      >
        {MODES.filter((mode) => allowUndated || mode !== 'none').map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={value.mode === mode}
            disabled={disabled}
            onClick={() => onChange({ ...value, mode })}
            className={cn(
              'min-h-11 rounded-md px-2 text-[0.8em] font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              value.mode === mode
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-surface-tinted',
            )}
          >
            {t(`assets.store.expiryInput.${mode}`)}
          </button>
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
