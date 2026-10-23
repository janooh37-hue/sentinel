import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { api, type DashboardSummary } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import { WidgetCard, type BreakdownRow } from '@/components/ui/widget-card'
import { BooksAwaitingWidget } from './BooksAwaitingWidget'
import { SentApprovalsWidget } from './SentApprovalsWidget'
import { InboxWidget } from './InboxWidget'
import type { WidgetId } from '@/lib/dashboardLayout'
import type { WidgetProps } from './types'
import { useDashboardRuntime } from './dashboardWidgetContext'


/** Temporary single adapter for the existing widget bodies; remove entries as content migrates. */
export function LegacyWidget({ id }: WidgetProps & { id: Exclude<WidgetId, 'quick_actions'> }): React.JSX.Element {
    const { onNavigate } = useDashboardRuntime()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const summaryQuery = useQuery({ queryKey: ['dashboard'], queryFn: api.getDashboardSummary, staleTime: 60_000 })
    const summary: DashboardSummary | undefined = summaryQuery.data
    const ledgerByDirection = { incoming: 0, outgoing: 0, internal: 0 }
    for (const row of summary?.recent_ledger ?? []) {
      if (row.direction === 'incoming') ledgerByDirection.incoming++
      else if (row.direction === 'outgoing') ledgerByDirection.outgoing++
      else ledgerByDirection.internal++
    }
    const body = () => {
    switch (id) {
      case 'pending':
        return (
          <PendingDocumentsCard
            docsCount={summary?.totals.forms_this_month ?? 0}
            currency={t('dashboard.pending.currency')}
            header={t('dashboard.pending.title')}
            reviewLabel={t('dashboard.pending.review')}
            footnote={t('dashboard.pending.footnote', {
              count: summary?.totals.forms_this_month ?? 0,
            })}
            onClick={() => onNavigate('books')}
            isLoading={summaryQuery.isPending}
          />
        )
      case 'waiting_approvals':
        return <BooksAwaitingWidget />
      case 'sent_approvals':
        return <SentApprovalsWidget />
      case 'inbox':
        return <InboxWidget />
      case 'drafts': {
        const draftCount = summary?.totals.book_draft_count ?? 0
        return (
          <WidgetCard
            header={t('dashboard.widgets.drafts.header')}
            big={draftCount}
            delta={
              draftCount > 0
                ? { tone: 'warn', label: t('dashboard.widgets.drafts.deltaWarn', { count: draftCount }) }
                : { tone: 'steady', label: t('dashboard.widgets.drafts.deltaSteady') }
            }
            actionLabel={t('dashboard.widgets.drafts.action')}
            onAction={() => navigate('/books?status=none')}
          />
        )
      }
      case 'ledger':
        return (
          <WidgetCard
            header={t('dashboard.widgets.ledger.header')}
            big={ledgerByDirection.incoming + ledgerByDirection.outgoing + ledgerByDirection.internal}
            delta={
              ledgerByDirection.incoming > 0
                ? { tone: 'warn', label: t('dashboard.widgets.ledger.deltaWarn', { count: ledgerByDirection.incoming }) }
                : { tone: 'steady', label: t('dashboard.widgets.ledger.deltaSteady') }
            }
            breakdown={[
              { color: 'success', label: t('dashboard.widgets.ledger.incoming'), value: ledgerByDirection.incoming },
              { color: 'accent', label: t('dashboard.widgets.ledger.outgoing'), value: ledgerByDirection.outgoing },
              { color: 'primary', label: t('dashboard.widgets.ledger.internal'), value: ledgerByDirection.internal },
            ] satisfies BreakdownRow[]}
            meta={t('dashboard.widgets.ledger.metaRecent', { count: summary?.recent_ledger.length ?? 0 })}
            actionLabel={t('dashboard.widgets.ledger.action')}
            onAction={() => onNavigate('ledger')}
          />
        )
    }
    }
    return <div className="h-full min-h-0 overflow-hidden [&>*]:!mb-0">{body()}</div>
}


interface PendingDocumentsCardProps {
  docsCount: number
  currency: string
  header: string
  reviewLabel: string
  footnote: string
  onClick: () => void
  isLoading: boolean
}

function PendingDocumentsCard({
  docsCount,
  currency,
  header,
  reviewLabel,
  footnote,
  onClick,
  isLoading,
}: PendingDocumentsCardProps): React.JSX.Element {
  // Progress bar = share of the calendar month elapsed. Day 1 → 0%,
  // last day of the month → 100%. Honest, always-moving anchor that
  // pairs naturally with the "N documents this month" footnote.
  const now = new Date()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const pct = Math.round(((now.getDate() - 1) / daysInMonth) * 100)

  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer group relative h-full w-full overflow-hidden rounded-2xl bg-surface p-5 text-start transition-all duration-200 hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="text-[0.86em] font-medium text-muted-foreground">{header}</div>

      <div className="mt-2.5 text-[2.4em] font-bold leading-none tracking-tight text-foreground tabular-nums">
        <span className="me-1.5 text-[0.32em] font-medium text-muted-foreground align-middle">
          {currency}
        </span>
        {isLoading ? <Skeleton className="h-9 w-16" /> : docsCount}
      </div>

      {/* Progress bar — decorative proxy (not a true completion %), hidden
          from AT. After the one-shot width grow finishes, a slow opacity
          pulse keeps the bar feeling "alive" without being distracting (the
          `infinite` animation kicks in only after the grow completes via
          the chained delay). */}
      <div
        aria-hidden="true"
        className="my-3.5 h-[5px] overflow-hidden rounded-full bg-surface-tinted"
      >
        <div
          className="dash-pending-bar h-full rounded-full bg-accent"
          style={{
            width: `${pct}%`,
            animation:
              'dash-pending-grow 1.4s ease-out, dash-pending-pulse 3s ease-in-out infinite 1.4s',
          }}
        />
      </div>
      <style>{`
        @keyframes dash-pending-grow {
          from { width: 0%; }
        }
        @keyframes dash-pending-pulse {
          0%, 100% { opacity: 0.85; }
          50%      { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          /* Reset both animations under reduced-motion — bar still renders
             at its final width but doesn't grow or pulse. */
          .dash-pending-bar { animation: none !important; }
        }
      `}</style>

      <div className="flex items-center justify-between text-[0.78em] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
          {footnote}
        </span>
        <span
          className="dash-view-pill rounded-full bg-primary px-4 py-1.5 text-[0.78em] font-medium text-primary-foreground shadow-sm transition-all duration-200 group-hover:scale-105 group-hover:bg-primary-hover group-hover:shadow-md motion-reduce:!transform-none motion-reduce:!shadow-sm"
          aria-hidden
        >
          {reviewLabel}
        </span>
      </div>

      <ChevronRight
        aria-hidden
        className="absolute end-5 top-5 h-3.5 w-3.5 text-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-muted-foreground rtl:group-hover:-translate-x-0.5 motion-reduce:!transform-none"
        strokeWidth={1.8}
      />
      {/* Direct-hover pop on the View pill — a tighter spring on top of the
          calm card-hover swell. Animation (not a static transform) so it wins
          over the group-hover scale while playing, then settles back. */}
      <style>{`
        .dash-view-pill:hover { animation: dash-view-pop 320ms cubic-bezier(0.34, 1.35, 0.64, 1); }
        @keyframes dash-view-pop {
          0%   { transform: scale(1.05); }
          55%  { transform: scale(1.10); }
          100% { transform: scale(1.08); }
        }
        @media (prefers-reduced-motion: reduce) {
          .dash-view-pill:hover { animation: none; }
        }
      `}</style>
    </button>
  )
}


