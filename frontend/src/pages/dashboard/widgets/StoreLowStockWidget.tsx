import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { useFitCount } from '@/components/dashboard/useFitCount'
import { api } from '@/lib/api'
import { localized } from '@/lib/language'
import { itemName } from '@/pages/assets/store/storeUtils'
import { PEOPLE_BIG, PEOPLE_LINK, PEOPLE_META, PEOPLE_NAME, PEOPLE_ROW, PeopleFeedback } from './peopleWidgetParts'
import type { WidgetProps } from './types'

const TO = '/holdings/store'
const KEY = 'dashboard.widgets.store_low_stock'

export function StoreLowStockWidget({ tier, rows }: WidgetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
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
                    <span dir="auto" className={PEOPLE_NAME}>{itemName(item, i18n.language)}</span>
                    <bdi dir="ltr" className={`${PEOPLE_META} font-mono tabular-nums`}>{item.item_code}</bdi>
                  </span>
                  <span className={`${PEOPLE_META} text-end`}>
                    <span className="block">{t(`${KEY}.onHand`)}: <bdi dir="ltr" className="font-mono tabular-nums">{item.on_hand}</bdi></span>
                    <span className="block">{t(`${KEY}.minimum`)}: <bdi dir="ltr" className="font-mono tabular-nums">{item.minimum_level}</bdi></span>
                    <span dir="auto">{item.contains_qty ? localized(item.contains_unit_ar, item.contains_unit_en, i18n.language) : localized(item.counting_unit_ar, item.counting_unit_en, i18n.language)}</span>
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
