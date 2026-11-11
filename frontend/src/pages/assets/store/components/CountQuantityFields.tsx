import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { normalizeDigits } from '@/lib/utils'
import { containsUnit, countingUnit, hasContains, type QuantityParts, type StoreUnits } from '../storeUtils'

interface Props {
  id: string
  item: StoreUnits
  value: QuantityParts
  label: string
  describedBy: string
  invalid: boolean
  disabled: boolean
  onChange: (value: QuantityParts) => void
}

/** Both visible fields are required for a blind count; receiving keeps its own blank-part rules. */
export function CountQuantityFields({ id, item, value, label, describedBy, invalid, disabled, onChange }: Props) {
  const { t, i18n } = useTranslation()
  const unit = countingUnit(item, i18n.language)
  const looseUnit = containsUnit(item, i18n.language)
  const contains = hasContains(item)
  return <fieldset aria-labelledby={`${id}-context`} className={`grid gap-3 ${contains ? 'sm:grid-cols-2' : ''}`}>
    <legend id={`${id}-context`} className="sr-only">{label}</legend>
    <label htmlFor={id} className="min-w-0 space-y-2 text-sm font-medium">
      <span className="block">{t('assets.store.counts.countIn', { unit })}</span>
      <Input id={id} type="text" inputMode="numeric" dir="ltr" autoComplete="off" className="h-12 font-mono text-lg tabular-nums" value={value.units} aria-required="true" aria-invalid={invalid || undefined} aria-describedby={`${id}-context ${describedBy}`} disabled={disabled} onChange={event => onChange({ ...value, units: normalizeDigits(event.target.value) })} />
    </label>
    {contains && <label htmlFor={`${id}-loose`} className="min-w-0 space-y-2 text-sm font-medium">
      <span className="block">{t('assets.store.counts.looseUnits', { unit: looseUnit })}</span>
      <Input id={`${id}-loose`} type="text" inputMode="numeric" dir="ltr" autoComplete="off" className="h-12 font-mono text-lg tabular-nums" value={value.loose} aria-required="true" aria-invalid={invalid || undefined} aria-describedby={`${id}-context ${describedBy}`} disabled={disabled} onChange={event => onChange({ ...value, loose: normalizeDigits(event.target.value) })} />
    </label>}
  </fieldset>
}
