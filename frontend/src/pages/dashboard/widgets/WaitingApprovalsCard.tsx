/**
 * WaitingApprovalsCard — Top-zone "glance" big card. Shows the count of books
 * awaiting the signed-in user's signing decision and a Review action. The
 * full interactive queue (BooksAwaitingWidget) renders when this widget lives
 * in a lower zone instead; this is only the compact top-slot variant.
 *
 * Self-hides when the user lacks `books.approve` (returns null). When the
 * count is 0 it stays visible with a calm "all clear" line — Top slots are
 * dashboard anchors and shouldn't collapse.
 */

import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronRight, Stamp } from 'lucide-react'

import { api } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { Skeleton } from '@/components/ui/skeleton'

interface Props {
  onReview: () => void
}

export function WaitingApprovalsCard({
  onReview,
}: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const { has } = useCapabilities()

  const awaitingQuery = useQuery({
    queryKey: ['books', 'awaiting'],
    queryFn: api.listAwaitingBooks,
    staleTime: 30_000,
    enabled: has('books.approve'),
  })

  if (!has('books.approve')) return null

  const count = awaitingQuery.data?.length ?? 0
  const isLoading = awaitingQuery.isPending

  return (
    <button
      type="button"
      onClick={onReview}
      aria-label={t('dashboard.widgetLabels.waiting_approvals_aria', { count, defaultValue: 'Waiting approvals: {{count}}. Review.' })}
      className="cursor-pointer group relative h-full w-full overflow-hidden rounded-2xl bg-surface p-5 text-start transition-all duration-200 hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="flex items-center gap-2 text-[0.86em] font-medium text-muted-foreground">
        <Stamp className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        {t('dashboard.widgetLabels.waiting_approvals')}
      </div>

      <div className="mt-2.5 text-[2.4em] font-bold leading-none tracking-tight text-foreground tabular-nums">
        {isLoading ? <Skeleton className="h-9 w-16" /> : count}
      </div>

      <div className="mt-3.5 flex items-center justify-between text-[0.78em] text-muted-foreground">
        {count > 0 ? (
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
            {t('books.approval.awaitingTitle')}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-success">
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            {t('books.approval.awaitingEmpty')}
          </span>
        )}
        <span
          className="rounded-full bg-primary px-4 py-1.5 text-[0.78em] font-medium text-primary-foreground shadow-sm transition-all duration-200 group-hover:scale-105 group-hover:bg-primary-hover motion-reduce:!transform-none"
          aria-hidden
        >
          {t('dashboard.widgetLabels.waiting_approvals_cta', { defaultValue: 'Review' })}
        </span>
      </div>

      <ChevronRight
        aria-hidden
        className="absolute end-5 top-5 h-3.5 w-3.5 text-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-muted-foreground rtl:group-hover:-translate-x-0.5 motion-reduce:!transform-none"
        strokeWidth={1.8}
      />
    </button>
  )
}
