import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'

export interface WidgetFrameProps {
  title: string
  count?: number
  viewAllTo?: string
  children: ReactNode
}

export function WidgetFrame({ title, count, viewAllTo, children }: WidgetFrameProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-hairline bg-surface p-4" aria-label={title}>
      <header className="flex shrink-0 items-start justify-between gap-2 pb-2">
        <h3 className="min-w-0 text-[0.78em] font-medium leading-snug text-muted-foreground">
          {title}
          {count != null && <span className="ms-1.5 inline-flex rounded-full bg-surface-tinted px-1.5 font-mono tabular-nums text-foreground">{count}</span>}
        </h3>
        {viewAllTo && (
          <Link to={viewAllTo} className="inline-flex shrink-0 items-center rounded-sm text-[0.7em] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t('dashboard.viewAll')}<ChevronRight aria-hidden className="size-3 rtl:rotate-180" />
          </Link>
        )}
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </section>
  )
}
