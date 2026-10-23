import { useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DashboardRuntimeContext } from '@/pages/dashboard/widgets/dashboardWidgetContext'

export const WIDGET_SUPPORT = 'text-[0.75em] leading-tight'

export function WidgetEmpty({ message, to, action }: { message: string; to?: string; action: string }): React.JSX.Element {
  return (
    <div className={`${WIDGET_SUPPORT} flex shrink-0 flex-col items-start gap-0.5 pt-1 text-muted-foreground`}>
      <p>{message}</p>
      {to && <Link to={to} className="rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{action}</Link>}
    </div>
  )
}

export interface WidgetFrameProps {
  title: string
  count?: number
  viewAllTo?: string
  compact?: boolean
  children: ReactNode
}

export function WidgetFrame({ title, count, viewAllTo, compact = false, children }: WidgetFrameProps): React.JSX.Element {
  const { t } = useTranslation()
  const editing = useContext(DashboardRuntimeContext)?.editing ?? false
  const viewAllLabel = t('dashboard.widgets.viewAll', { title })
  return (
    <section className={`@container/widget flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-hairline bg-surface ${editing ? 'px-3 py-2' : 'p-4'}`} aria-label={title}>
      {!editing && <header className="flex shrink-0 items-start justify-between gap-1 pb-2">
        <h3 className="flex min-w-0 items-start text-[0.85em] font-medium leading-snug text-muted-foreground">
          <span className="line-clamp-2" title={title}>{title}</span>
          {count != null && <span className="ms-1.5 inline-flex shrink-0 rounded-full bg-surface-tinted px-1.5 font-mono tabular-nums text-foreground">{count}</span>}
        </h3>
        {viewAllTo && <TooltipProvider><Tooltip>
          <TooltipTrigger asChild>
            <Link to={viewAllTo} aria-label={viewAllLabel} className="inline-flex min-h-7 min-w-7 shrink-0 items-center justify-center rounded-sm text-[0.75em] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {!compact && <span className="hidden @[20rem]/widget:inline">{t('dashboard.viewAll')}</span>}
              <ChevronRight aria-hidden className="size-3.5 rtl:rotate-180" />
            </Link>
          </TooltipTrigger>
          {createPortal(<TooltipContent>{viewAllLabel}</TooltipContent>, document.body)}
        </Tooltip></TooltipProvider>}
      </header>}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </section>
  )
}
