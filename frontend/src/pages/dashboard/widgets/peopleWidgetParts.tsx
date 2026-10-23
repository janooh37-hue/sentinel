import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WIDGET_SUPPORT } from '@/components/dashboard/WidgetFrame'
import type { DashboardOnLeaveItem } from '@/lib/api'
import { splitBilingual } from '@/lib/bilingualValue'
import { summaryEmployeeName } from './peopleWidgetData'

export const PEOPLE_LINK = 'rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
export const PEOPLE_BIG = 'font-mono text-[2em] font-bold leading-none tracking-tight tabular-nums text-foreground'
export const PEOPLE_ROW = 'flex min-w-0 items-center gap-2 rounded-lg py-2 text-start hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
export const PEOPLE_META = `${WIDGET_SUPPORT} text-muted-foreground`
export const PEOPLE_NAME = 'block truncate text-[0.85em] font-medium'


export function PeopleFeedback({ pending, retry }: { pending?: boolean; retry: () => unknown }): React.JSX.Element {
  const { t } = useTranslation()
  return pending ? (
    <div role="status" aria-label={t('common.loading')} className="space-y-2 motion-safe:animate-pulse">
      <div className="h-7 w-1/3 rounded bg-surface-tinted" />
      <div className="h-3 w-3/4 rounded bg-surface-tinted" />
    </div>
  ) : (
    <p role="alert" className="text-[0.75em] text-muted-foreground">{t('common.loadError')}{' '}
      <button type="button" onClick={() => void retry()} className={PEOPLE_LINK}>{t('common.retry')}</button>
    </p>
  )
}

export function MorePeople({ count, to, label }: { count: number; to: string; label: string }): React.JSX.Element {
  return count > 0 ? <Link to={to} className={`${PEOPLE_LINK} ${WIDGET_SUPPORT} shrink-0 border-t border-hairline pt-1`}>{label}</Link> : <></>
}


export function PeopleAvatar({ name }: { name: string }): React.JSX.Element {
  const parts = name.trim().split(/\s+/)
  const initials = parts.map((part) => part[0]).filter(Boolean)
  return <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[0.75em] font-semibold text-primary">{[initials[0], initials.length > 1 ? initials.at(-1) : parts[0]?.[1]].join('').toUpperCase()}</span>
}

export function LeaveWidgetRow({ item, language, when }: { item: DashboardOnLeaveItem; language: string; when: string }): React.JSX.Element {
  const { t } = useTranslation()
  const name = summaryEmployeeName(item, language)
  return (
    <li className="min-h-0">
      <Link to={`/leaves?open=${item.leave_id}`} className={PEOPLE_ROW}>
        <PeopleAvatar name={name} />
        <span className="min-w-0 flex-1">
          <bdi className={PEOPLE_NAME}>{name}</bdi>
          <span className={`${PEOPLE_META} block truncate`}><bdi className="font-mono">{item.employee_id}</bdi> · {t(`leaves.type.${item.leave_type}`, { defaultValue: splitBilingual(item.leave_type, language) })}</span>
        </span>
        <span className={`${WIDGET_SUPPORT} max-w-[45%] text-end text-warning`}>{when}</span>
      </Link>
    </li>
  )
}
