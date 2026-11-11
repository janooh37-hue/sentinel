import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { useFitCount } from '@/components/dashboard/useFitCount'
import { api } from '@/lib/api'
import { StoreItemSummary, StoreQuantity } from '@/pages/assets/store/components/RecordParts'
import { PEOPLE_BIG, PEOPLE_LINK, PEOPLE_META, PEOPLE_ROW, PeopleFeedback } from './peopleWidgetParts'
import type { WidgetProps } from './types'

const TO = '/holdings/store'
const KEY = 'dashboard.widgets.store_low_stock'

export function StoreLowStockWidget({ tier, rows }: WidgetProps): React.JSX.Element {
  const { t } = useTranslation()
  const query = useQuery({ queryKey: ['store-dashboard'], queryFn: api.getStoreDashboard })
  const items = query.data?.low_stock ?? []
  const list = tier === 'tall' || tier === 'list'
  const { listRef, visibleCount } = useFitCount(Math.min(items.length, rows))
  const more = items.length - visibleCount
  return (
    <WidgetFrame title={t(`${KEY}.title`)} viewAllTo={TO} compact={tier === 'glance'}>
      {query.isPending || query.isError || !query.data ? <PeopleFeedback pending={query.isPending} retry={query.refetch} /> : items.length === 0 ? (
        <p className={PEOPLE_META}>{t(`${KEY}.empty`)}</p>
      ) : list ? (
        <>
          <ul ref={listRef} className="min-h-0 flex-1 overflow-hidden">
            {items.slice(0, visibleCount).map((item) => (
              <li key={item.item_id}>
                <Link to={TO} className={`${PEOPLE_ROW} min-h-11`}>
                  <span className="min-w-0 flex-1">
                    <StoreItemSummary item={item} size={44} showCode />
                  </span>
                  <span className={`${PEOPLE_META} text-end`}>
                    <span className="block">{t(`${KEY}.onHand`)}: <StoreQuantity value={item.on_hand} item={item} /></span>
                    <span className="block">{t(`${KEY}.minimum`)}: <StoreQuantity value={item.minimum_level} item={item} /></span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {more > 0 && <Link to={TO} className={`${PEOPLE_LINK} ${PEOPLE_META} flex min-h-11 shrink-0 items-center`}>{t(`${KEY}.more`, { total: more })}</Link>}
        </>
      ) : (
        <>
          <Link to={TO} className={`${PEOPLE_LINK} min-h-11 self-start`}><bdi dir="ltr" className={PEOPLE_BIG}>{items.length}</bdi></Link>
          <p className={PEOPLE_META}>{t(`${KEY}.meaning`)}</p>
        </>
      )}
    </WidgetFrame>
  )
}
