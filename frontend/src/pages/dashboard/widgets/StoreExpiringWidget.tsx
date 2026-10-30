import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { useFitCount } from '@/components/dashboard/useFitCount'
import { api } from '@/lib/api'
import { formatDmy } from '@/lib/formatDmy'
import { PEOPLE_BIG, PEOPLE_LINK, PEOPLE_META, PEOPLE_NAME, PEOPLE_ROW, PeopleFeedback } from './peopleWidgetParts'
import type { WidgetProps } from './types'

const TO = '/holdings/store'
const KEY = 'dashboard.widgets.store_expiring'

export function StoreExpiringWidget({ tier, rows }: WidgetProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const query = useQuery({ queryKey: ['store-dashboard'], queryFn: api.getStoreDashboard })
  const data = query.data
  const batches = [...(data?.expired ?? []), ...(data?.expiring_soon ?? [])]
  const list = tier === 'tall' || tier === 'list'
  const { listRef, visibleCount } = useFitCount(Math.min(batches.length, rows))
  const isAr = i18n.language.startsWith('ar')
  const days = data?.expiring_soon_days ?? 60
  const more = batches.length - visibleCount
  return (
    <WidgetFrame title={t(`${KEY}.title`)} viewAllTo={TO} compact={tier === 'glance'}>
      {query.isPending || query.isError || !data ? <PeopleFeedback pending={query.isPending} retry={query.refetch} /> : batches.length === 0 ? (
        <p className={PEOPLE_META}>{t(`${KEY}.empty`, { days })}</p>
      ) : list ? (
        <>
          <p className={`${PEOPLE_META} shrink-0`}>{t(`${KEY}.window`, { days })}</p>
          <ul ref={listRef} className="min-h-0 flex-1 overflow-hidden">
            {batches.slice(0, visibleCount).map((batch, index) => (
              <li key={batch.batch_id}>
                <Link to={TO} className={`${PEOPLE_ROW} min-h-11`}>
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className={PEOPLE_NAME}>{isAr ? batch.item_name_ar || batch.item_name_en : batch.item_name_en || batch.item_name_ar}</span>
                    <span className={`${PEOPLE_META} block`}><bdi dir="ltr" className="font-mono tabular-nums">{batch.item_code}</bdi> · <bdi dir="ltr" className="font-mono tabular-nums">{batch.on_hand}</bdi> <span dir="auto">{batch.contains_qty ? (isAr ? batch.contains_unit_ar || batch.contains_unit_en : batch.contains_unit_en || batch.contains_unit_ar) : (isAr ? batch.counting_unit_ar || batch.counting_unit_en : batch.counting_unit_en || batch.counting_unit_ar)}</span></span>
                  </span>
                  <span className={`${PEOPLE_META} shrink-0 text-end`}>
                    <span className="block">{t(`${KEY}.${index < data.expired.length ? 'expired' : 'expiring'}`)}</span>
                    <bdi dir="ltr" className="font-mono tabular-nums">{batch.expiry_date ? (batch.expiry_month_only ? `${batch.expiry_date.slice(5, 7)}/${batch.expiry_date.slice(0, 4)}` : formatDmy(batch.expiry_date)) : ''}</bdi>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {more > 0 && <Link to={TO} className={`${PEOPLE_LINK} ${PEOPLE_META} flex min-h-11 shrink-0 items-center`}>{t(`${KEY}.more`, { total: more })}</Link>}
        </>
      ) : (
        <>
          <Link to={TO} className={`${PEOPLE_LINK} min-h-11 self-start`}><bdi dir="ltr" className={PEOPLE_BIG}>{batches.length}</bdi></Link>
          <p className={PEOPLE_META}>{t(`${KEY}.window`, { days })}</p>
          <p className={PEOPLE_META}><span>{t(`${KEY}.expired`)}</span>: <bdi dir="ltr" className="font-mono tabular-nums">{data.expired.length}</bdi></p>
          <p className={PEOPLE_META}><span>{t(`${KEY}.expiring`)}</span>: <bdi dir="ltr" className="font-mono tabular-nums">{data.expiring_soon.length}</bdi></p>
        </>
      )}
    </WidgetFrame>
  )
}
