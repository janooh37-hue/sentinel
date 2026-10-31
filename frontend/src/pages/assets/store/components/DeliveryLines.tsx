import { type Dispatch, type ReactNode, type SetStateAction, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'

import { Field, FieldGrid } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { EMPTY_QUANTITY, itemName } from '../storeUtils'
import type { QuantityParts } from '../storeUtils'
import type { StorePickerItem } from '@/lib/api'
import { type DeliveryLine, type DeliveryLineErrors, newDeliveryLine } from './deliveryLineModel'
import { ExpiryInput } from './ExpiryInput'
import { QuantityInput } from './QuantityInput'
import { StoreItemPicker } from './StoreItemPicker'

interface Props {
  /** Prefix for element ids; line `n` uses `${idPrefix}-${key}-…`. */
  idPrefix: string
  lines: DeliveryLine[]
  onChange: Dispatch<SetStateAction<DeliveryLine[]>>
  errors: DeliveryLineErrors
  /** The form alert that summarises line errors (referenced by invalid fields). */
  alertId: string
  disabled?: boolean
  /** Per-line content before the fields (e.g. the scanned row image). */
  renderLineStart?: (line: DeliveryLine, index: number) => ReactNode
  /** Extra per-line fields after expiry (e.g. the quantity the note listed). */
  renderLineFields?: (line: DeliveryLine, index: number) => ReactNode
  renderLineLegend?: (line: DeliveryLine, index: number) => ReactNode
  renderLineActions?: (line: DeliveryLine, index: number) => ReactNode
  renderQuantityAside?: (line: DeliveryLine, index: number) => ReactNode
  quantityLabel?: string
  allowAdd?: boolean
  allowUndated?: boolean
  quantityForItem?: (line: DeliveryLine, item: StorePickerItem | null) => QuantityParts
}

/** The delivery line editor: item, quantity and expiry per line, add/remove lines. */
export function DeliveryLines({ idPrefix, lines, onChange, errors, alertId, disabled = false, renderLineStart, renderLineFields, renderLineLegend, renderLineActions, renderQuantityAside, quantityLabel, allowAdd = true, allowUndated = true, quantityForItem }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  // Monotonic: a removed line's key (and its errors) is never reused.
  const nextKey = useRef(Math.max(-1, ...lines.map((line) => line.key)) + 1)
  const updateLine = (key: number, patch: Partial<DeliveryLine>) => onChange((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line))
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`${idPrefix}-lines`}>
      <h3 id={`${idPrefix}-lines`} className="font-semibold text-foreground">{t('assets.store.deliveries.lines')}</h3>
      {lines.map((line, index) => {
        const prefix = `${idPrefix}-${line.key}`
        const issue = errors[line.key]
        return (
          <fieldset key={line.key} disabled={disabled} className="min-w-0 border-t border-border pt-3">
            <legend className="px-1 text-sm font-medium text-foreground">{renderLineLegend?.(line, index) ?? t('assets.store.deliveries.line', { number: index + 1 })}</legend>
            {renderLineActions ? renderLineActions(line, index) : <div className="mb-2 flex justify-end">
              <Button type="button" variant="ghost" className="min-h-11 text-accent" disabled={lines.length === 1 || disabled} onClick={() => onChange((current) => current.filter((entry) => entry.key !== line.key))} aria-label={t('assets.store.deliveries.removeLine', { number: index + 1 })}>
                <Trash2 aria-hidden className="h-4 w-4" />{t('assets.store.deliveries.remove')}
              </Button>
            </div>}
            {renderLineStart?.(line, index)}
            <FieldGrid>
              <Field id={`${prefix}-item`} label={t('assets.store.deliveries.item')} required full={!!renderQuantityAside} error={issue?.item}>
                <StoreItemPicker id={`${prefix}-item`} value={line.item?.id ?? null} onChange={(item) => updateLine(line.key, { item, quantity: quantityForItem?.(line, item) ?? { ...EMPTY_QUANTITY } })} disabled={disabled} invalid={!!issue?.item} describedBy={issue?.item ? alertId : undefined} />
              </Field>
              {renderQuantityAside?.(line, index)}
              <Field id={`${prefix}-quantity`} label={quantityLabel ?? t('assets.store.deliveries.quantity')} required error={issue?.quantity}>
                {line.item ? <QuantityInput id={`${prefix}-quantity`} item={line.item} value={line.quantity} onChange={(quantity) => updateLine(line.key, { quantity })} label={itemName(line.item, i18n.language)} invalid={!!issue?.quantity} describedBy={issue?.quantity ? alertId : undefined} disabled={disabled} required /> : <p className="py-3 text-sm text-muted-foreground">{t('assets.store.deliveries.selectItemFirst')}</p>}
              </Field>
              <Field id={`${prefix}-expiry`} label={t('assets.store.deliveries.expiry')} required full error={issue?.expiry}>
                <ExpiryInput id={`${prefix}-expiry`} value={line.expiry} onChange={(expiry) => updateLine(line.key, { expiry })} invalid={!!issue?.expiry} describedBy={issue?.expiry ? alertId : undefined} disabled={disabled} allowUndated={allowUndated} />
              </Field>
              {renderLineFields?.(line, index)}
            </FieldGrid>
          </fieldset>
        )
      })}
      {allowAdd && <Button type="button" variant="secondary" className="min-h-11 self-start" disabled={disabled} onClick={() => { const key = Math.max(nextKey.current, ...lines.map((line) => line.key + 1)); nextKey.current = key + 1; onChange((current) => [...current, newDeliveryLine(key)]) }}><Plus aria-hidden className="h-4 w-4" />{t('assets.store.deliveries.addLine')}</Button>}
    </section>
  )
}
