import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { WidgetFrame } from '@/components/dashboard/WidgetFrame'
import { ServiceArtwork } from '@/components/ui/service-artwork'
import { isQuickActionAllowed, type QuickActionId } from '@/lib/dashboardLayout'
import { QUICK_ACTION_META } from '@/lib/quickActions'
import { cn } from '@/lib/utils'
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
        <div
          className="grid min-h-0 flex-1 auto-rows-fr gap-x-2 gap-y-1"
          style={{ gridTemplateColumns: `repeat(${tier === 'glance' ? 1 : Math.min(columns, actions.length)}, minmax(0, 1fr))` }}
        >
          {actions.map((action) => {
            const meta = QUICK_ACTION_META[action.id as QuickActionId]
            return (
              <Link
                key={action.id}
                to={meta.href}
                className={cn(
                  'flex min-h-0 min-w-0 items-center rounded-md px-2 py-0.5 text-[0.8em] font-semibold leading-normal text-foreground transition-colors hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none',
                  tier === 'glance' ? 'gap-2 text-start' : 'flex-col justify-center gap-1 text-center',
                )}
              >
                {meta.artwork ? (
                  <ServiceArtwork artwork={meta.artwork} size="gallery" className="shrink-0" />
                ) : (
                  <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center text-[1.75em]">{meta.emoji}</span>
                )}
                <span className="min-w-0">{t(`dashboard.quickActionLabels.${meta.slug}`)}</span>
              </Link>
            )
          })}
        </div>
      )}
    </WidgetFrame>
  )
}
