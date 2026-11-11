/**
 * Content shared by every Store record line (deliveries, counts, disposals,
 * dashboard): the item's code and name, and a quantity in Counting units plus
 * loose. Pages own the surrounding layout (`<li>`, cards, table cells).
 */

import { useTranslation } from 'react-i18next'

import { StoreItemArt } from '@/components/StoreItemArt'
import { cn } from '@/lib/utils'
import { formatQuantity, formatQuantityParts, type StoreUnits } from '../storeUtils'
import { storeDisplayName, storePackDescription, type StorePresentationItem } from '../storePresentation'

export function StorePackDescription({ item }: { item: StorePresentationItem }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  return <span dir="auto" className="block text-xs font-normal text-muted-foreground [overflow-wrap:anywhere]">{storePackDescription(item, i18n.language) ?? t('assets.store.presentation.packNotRecorded')}</span>
}

export function StoreItemSummary({ item, size = 80, showCode = false, className }: { item: StorePresentationItem; size?: number; showCode?: boolean; className?: string }): React.JSX.Element {
  const { i18n } = useTranslation()
  return <span className={cn('flex min-w-0 items-center gap-3', className)}>
    <StoreItemArt kind={item.art_kind} color={item.art_color} categoryId={item.category_id} brandLabel={item.brand_label} labelEn={item.generic_label_en} labelAr={item.generic_label_ar} size={size} className="shrink-0" />
    <span className="min-w-0 space-y-1">
      <span dir="auto" className="block font-medium [overflow-wrap:anywhere]">{storeDisplayName(item, i18n.language)}</span>
      <StorePackDescription item={item} />
      {showCode && <bdi dir="ltr" className="block font-mono text-xs text-muted-foreground">{item.code ?? item.item_code}</bdi>}
    </span>
  </span>
}

export function ItemIdentity({ row, stacked = false }: { row: StorePresentationItem; stacked?: boolean }): React.JSX.Element {
  return <StoreItemSummary item={row} size={stacked ? 52 : 44} showCode />
}

/** Base units as "3 cartons + 5 jars", isolated so the digits keep their order. */
export function StoreQuantity({ value, item }: { value: number; item: StoreUnits }): React.JSX.Element {
  const { i18n } = useTranslation()
  return <bdi dir="auto" className="whitespace-nowrap tabular-nums">{formatQuantity(value, item, i18n.language)}</bdi>
}

/** Keep signs and digits LTR without imposing that direction on translated units. */
export function SignedStoreQuantity({ value, item }: { value: number; item: StoreUnits }): React.JSX.Element {
  const { i18n } = useTranslation()
  return <bdi dir="auto" className="whitespace-nowrap tabular-nums">{formatQuantityParts(value, item, i18n.language).map((part, index) => <span key={index}>{index > 0 && ' + '}<bdi dir="ltr">{index === 0 && value >= 0 ? '+' : ''}{part.number}</bdi> {part.unit}</span>)}</bdi>
}
