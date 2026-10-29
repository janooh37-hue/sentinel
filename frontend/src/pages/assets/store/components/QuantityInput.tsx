/**
 * QuantityInput — "N cartons + M loose" when the item has `contains_qty`,
 * otherwise a single Counting-unit field. Values stay strings so a blank
 * input is distinguishable from 0 (the count screen requires every Batch to
 * be entered, 0 allowed — ADR 0009). Convert with `quantityFromParts`.
 */

import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import {
  containsUnit,
  countingUnit,
  hasContains,
  type QuantityParts,
  type StoreUnits,
} from '../storeUtils'

interface Props {
  /** Prefix for the two input ids; the units input id is exactly `id`. */
  id: string
  item: StoreUnits
  value: QuantityParts
  onChange: (next: QuantityParts) => void
  /** Accessible context, e.g. the item name and Batch expiry. */
  label: string
  invalid?: boolean
  describedBy?: string
  disabled?: boolean
  required?: boolean
}

const FIELD =
  'h-11 w-full min-w-0 text-end font-mono tabular-nums'

export function QuantityInput({
  id,
  item,
  value,
  onChange,
  label,
  invalid = false,
  describedBy,
  disabled = false,
  required = false,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const unit = countingUnit(item, i18n.language)
  const contains = hasContains(item)
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label className="flex min-w-0 flex-1 items-center gap-1.5">
        <Input
          id={id}
          type="text"
          dir="ltr"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          aria-label={t('assets.store.quantity.unitsAria', { label, unit })}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          disabled={disabled}
          value={value.units}
          onChange={(event) => onChange({ ...value, units: event.target.value })}
          className={cn(FIELD, invalid && 'border-destructive')}
        />
        <span className="shrink-0 text-xs text-muted-foreground" dir="auto">
          {unit}
        </span>
      </label>
      {contains && (
        <>
          <span aria-hidden className="text-muted-foreground">
            +
          </span>
          <label className="flex min-w-0 flex-1 items-center gap-1.5">
            <Input
              id={`${id}-loose`}
              type="text"
              dir="ltr"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              aria-label={t('assets.store.quantity.looseAria', {
                label,
                unit: containsUnit(item, i18n.language),
              })}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              disabled={disabled}
              value={value.loose}
              onChange={(event) => onChange({ ...value, loose: event.target.value })}
              className={cn(FIELD, invalid && 'border-destructive')}
            />
            <span className="shrink-0 text-xs text-muted-foreground" dir="auto">
              {containsUnit(item, i18n.language)}
            </span>
          </label>
        </>
      )}
    </div>
  )
}
