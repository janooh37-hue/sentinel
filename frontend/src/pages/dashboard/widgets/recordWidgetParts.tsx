import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WIDGET_SUPPORT } from '@/components/dashboard/WidgetFrame'

export const INLINE_LINK = 'rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
export const RECORD_ROW = `flex min-w-0 items-center gap-2 rounded-md py-1 ${WIDGET_SUPPORT} hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`
export const BIG_NUMBER = 'font-mono text-[2em] font-bold leading-none tracking-tight text-foreground tabular-nums'

export function WidgetFeedback({ pending, retry }: { pending?: boolean; retry: () => unknown }): React.JSX.Element {
  const { t } = useTranslation()
  return pending ? (
    <div role="status" aria-label={t('common.loading')} className="flex min-h-0 flex-1 flex-col gap-2 motion-safe:animate-pulse">
      <div className="h-8 w-16 rounded bg-surface-tinted" />
      <div className="h-3 w-3/4 rounded bg-surface-tinted" />
    </div>
  ) : (
    <div role="alert" className="text-[0.75em] text-muted-foreground">
      <p>{t('common.loadError')}</p>
      <button type="button" className={`${INLINE_LINK} text-primary`} onClick={() => void retry()}>{t('common.retry')}</button>
    </div>
  )
}

export function MoreRecords({ count, to, labelKey }: { count: number; to: string; labelKey: string }): React.JSX.Element | null {
  const { t } = useTranslation()
  return count > 0 ? <Link to={to} className={`${INLINE_LINK} ${WIDGET_SUPPORT} shrink-0 pt-1 font-medium text-primary`}>{t(labelKey, { count })}</Link> : null
}

