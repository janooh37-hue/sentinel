import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { DeliveryLine } from './deliveryLineModel'
import { StoreItemSummary } from './RecordParts'
import { expiryFromValue, formatQuantity, quantityFromParts } from '../storeUtils'

/** Read-only snapshot of every active line; saving is only offered from this step. */
export function DeliveryReview({ lines, receivedOn, note, file, renderLineDetails }: {
  lines: DeliveryLine[]
  receivedOn: string
  note: string
  file: File | null
  renderLineDetails?: (line: DeliveryLine) => ReactNode
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  return <section className="flex min-w-0 flex-col gap-4">
    <h2 ref={heading} tabIndex={-1} className="text-[1.2em] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('assets.store.deliveries.reviewTitle')}</h2>
    <p className="text-muted-foreground">{t('assets.store.deliveries.reviewDescription')}</p>
    <p>{t('assets.store.deliveries.receivedOn')}: <bdi dir="ltr" className="font-mono tabular-nums">{receivedOn}</bdi></p>
    {note.trim() && <p dir="auto" className="whitespace-pre-wrap break-words">{note}</p>}
    {file && <p className="break-words">{t('assets.store.deliveries.deliveryNoteDisplay')}: <bdi dir="auto">{file.name}</bdi></p>}
    <ol className="divide-y divide-border">{lines.map((line) => {
      const expiry = expiryFromValue(line.expiry)
      return <li key={line.key} className="flex min-w-0 flex-col gap-3 py-4">
      {line.item && <>
        <StoreItemSummary item={line.item} size={72} showCode />
        <p>{t('assets.store.scan.received')}: <bdi dir="auto" className="font-mono tabular-nums">{formatQuantity(quantityFromParts(line.quantity, line.item)!, line.item, i18n.language)}</bdi></p>
      </>}
      <p>{t('assets.store.deliveries.expiry')}: {expiry ? <bdi dir="ltr" className="font-mono tabular-nums">{expiry}</bdi> : <span>{t('assets.store.expiry.none')}</span>}</p>
      {line.cartonContainsQty.trim() && <p>{t('assets.store.deliveries.contentsDisplay')}: <bdi dir="ltr" className="font-mono tabular-nums">{line.cartonContainsQty}</bdi></p>}
      {renderLineDetails?.(line)}
    </li>})}</ol>
  </section>
}
