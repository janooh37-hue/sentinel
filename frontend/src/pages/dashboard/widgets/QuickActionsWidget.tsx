import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { isQuickActionAllowed, type QuickActionId } from '@/lib/dashboardLayout'
import { QUICK_ACTION_META } from '@/lib/quickActions'
import { useDashboardRuntime } from './dashboardWidgetContext'
import type { WidgetProps } from './types'

export function QuickActionsWidget({ tier }: WidgetProps): React.JSX.Element {
  const { t } = useTranslation()
  const { layout, has, box } = useDashboardRuntime()
  const columns = box.cols === 2 ? 2 : Math.min(box.w * 2, 8)
  const count = tier === 'glance' ? 2 : columns * Math.max(box.h, 1)
  const actions = layout.quick_actions
    .filter((action) => action.visible && isQuickActionAllowed(action.id, has))
    .sort((a, b) => a.order - b.order)
    .slice(0, count)
  return (
    <WidgetFrame title={t('dashboard.widgets.quickActions.title')} viewAllTo="/services">
      {actions.length === 0 ? (
        <p className="text-[0.78em] text-muted-foreground">{t('dashboard.widgets.quickActions.empty')}</p>
      ) : (
        <div className="grid min-h-0 flex-1 gap-2 overflow-hidden" style={{ gridTemplateColumns: `repeat(${tier === 'glance' ? 1 : Math.min(columns, actions.length)}, minmax(0, 1fr))` }}>
          {actions.map((action) => {
            const meta = QUICK_ACTION_META[action.id as QuickActionId]
            return (
              <Link key={action.id} to={meta.href} className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-1 rounded-lg border border-hairline bg-surface-raised px-1.5 py-2 text-center text-[0.66em] font-medium leading-tight text-foreground transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                <span aria-hidden className="text-[1.6em]">{meta.emoji}</span>
                <span className="line-clamp-2">{t(`dashboard.quickActionLabels.${meta.slug}`)}</span>
              </Link>
            )
          })}
        </div>
      )}
    </WidgetFrame>
  )
}
