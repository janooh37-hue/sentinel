/**
 * Content shared by every Store record line (deliveries, counts, disposals,
 * dashboard): the item's code and name, and a quantity in Counting units plus
 * loose. Pages own the surrounding layout (`<li>`, cards, table cells).
 */

import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { formatQuantity, formatQuantityParts, itemName, type StoreUnits } from '../storeUtils'

interface ItemRow {
  item_code: string
  item_name_en: string
  item_name_ar?: string | null
}

/** Code (LTR run) and name. `stacked` puts the code above the name for narrow columns. */
export function ItemIdentity({ row, stacked = false }: { row: ItemRow; stacked?: boolean }): React.JSX.Element {
  const { i18n } = useTranslation()
  return (
    <div className={stacked ? 'flex min-w-0 flex-col gap-1' : 'flex flex-wrap items-baseline gap-2'}>
      <bdi dir="ltr" className={cn('font-mono tabular-nums text-muted-foreground', stacked && 'text-xs')}>{row.item_code}</bdi>
      <span dir="auto" className="font-medium">{itemName(row, i18n.language)}</span>
    </div>
  )
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
