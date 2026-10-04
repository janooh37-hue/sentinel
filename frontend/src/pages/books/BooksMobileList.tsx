/**
 * BooksMobileList — phone card list for the Records page: skeleton / error /
 * empty / card states inside pull-to-refresh, plus the per-row BookMobileCard.
 */

import { ArrowDownLeft, ArrowUpRight, BookOpen, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { BookRead } from '@/lib/api'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonRow } from '@/components/ui/skeleton'
import { PullToRefresh } from '@/components/refresh/PullToRefresh'
import { inmateReporterActionFor } from '@/components/books/book-detail-drawer-utils'
import { cn } from '@/lib/utils'
import { sealDescriptor, signedSourceOf } from './bookStateLabel'

function formatDate(iso: string): string {
  return iso.slice(0, 10)
}

export interface BooksMobileListProps {
  isPending: boolean
  isError: boolean
  onRetry: () => void
  rows: BookRead[]
  hasFilters: boolean
  isAr: boolean
  isInmateReporter: boolean
  canSubmit: boolean
  userId: number | undefined
  highlightedId: number | null
  onSubmit: (id: number) => void
  onOpen: (row: BookRead) => void
}

export function BooksMobileList({
  isPending,
  isError,
  onRetry,
  rows: mobileRows,
  hasFilters,
  isAr,
  isInmateReporter,
  canSubmit,
  userId,
  highlightedId,
  onSubmit: submitBook,
  onOpen: openBook,
}: BooksMobileListProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
          <div className="flex-1 min-h-0">
          <PullToRefresh>
          <div className="px-6 pb-6">
            {isPending ? (
              <div className="flex flex-col overflow-hidden rounded-2xl border border-hairline bg-surface">
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonRow key={i} cols={5} />
                ))}
              </div>
            ) : isError ? (
              <div className="rounded-2xl border border-hairline bg-surface py-12">
                <EmptyState
                  icon={BookOpen}
                  message={t('common.loadError')}
                  actionLabel={t('common.retry')}
                  onAction={() => onRetry()}
                />
              </div>
            ) : mobileRows.length === 0 ? (
              <div className="rounded-2xl border border-hairline bg-surface py-12">
                <EmptyState
                  icon={BookOpen}
                  message={hasFilters ? t('books.empty') : t('books.emptyUnfiltered')}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2 pb-24">
                {mobileRows.map((row) => (
                  <BookMobileCard
                    key={row.id}
                    row={row}
                    isAr={isAr}
                    canSubmit={
                      isInmateReporter
                        ? inmateReporterActionFor(row, userId) === 'edit-submit'
                        : canSubmit
                    }
                    highlighted={row.id === highlightedId}
                    onSubmit={() => submitBook(row.id)}
                    onOpen={() => openBook(row)}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
          </PullToRefresh>
          </div>
  )
}

function ApprovalStatePill({
  state,
  signingPath,
  signedSource,
  t,
}: {
  state: string
  signingPath?: string | null
  signedSource?: string | null
  t: (key: string) => string
}): React.JSX.Element {
  // Mobile keeps its own (amber-draft) chip palette for now — known deferral
  // for the next mobile pass; labels are path-aware via sealDescriptor.
  const variants: Record<string, string> = {
    none: 'bg-warning-soft text-warning',
    pending: 'bg-warning-soft text-warning',
    awaiting_scan: 'bg-info-soft text-info',
    approved: 'bg-success-soft text-success',
    rejected: 'bg-destructive/10 text-destructive',
    returned: 'bg-info-soft text-info',
  }
  const cls = variants[state] ?? 'bg-surface-tinted text-muted-foreground'
  // sealDescriptor falls back to the raw state string for unknown states.
  const label = t(sealDescriptor(state, { signingPath, signedSource }).labelKey)
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.72em] font-semibold uppercase tracking-[0.06em]',
        cls,
      )}
    >
      {label}
    </span>
  )
}

function DirectionPill({
  direction,
  t,
}: {
  direction: string | null
  t: (key: string) => string
}): React.JSX.Element {
  if (!direction) return <span className="text-muted-foreground">—</span>
  const isIncoming = direction === 'incoming'
  const Icon = isIncoming ? ArrowDownLeft : ArrowUpRight
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.72em] font-semibold uppercase tracking-[0.06em]',
        isIncoming
          ? 'bg-info-soft text-info'
          : 'bg-success-soft text-success',
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
      {t(`books.direction.${direction}`)}
    </span>
  )
}
// ─── Mobile-only book card ───────────────────────────────────────────────────
// Mirrors the desktop row but stacks ref + approval / subject / meta so the
// approval column never overflows the viewport (the dense table clips it).

interface BookMobileCardProps {
  row: BookRead
  isAr: boolean
  canSubmit: boolean
  highlighted: boolean
  onSubmit: () => void
  onOpen: () => void
  t: (key: string) => string
}

function BookMobileCard({
  row,
  isAr,
  canSubmit,
  highlighted,
  onSubmit,
  onOpen,
  t,
}: BookMobileCardProps): React.JSX.Element {
  const catLabel = isAr
    ? (row.category.name_ar ?? row.category.name_en)
    : (row.category.name_en ?? row.category.name_ar)
  return (
    <article
      data-id={row.id}
      role="button"
      tabIndex={0}
      className={cn(
        'flex cursor-pointer flex-col gap-2 rounded-2xl border border-hairline bg-surface p-3.5 transition-colors',
        highlighted && 'bg-accent-soft',
      )}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      {/* ref + approval action */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[0.85em] font-semibold text-primary">
          <bdi dir="ltr">{row.ref_number}</bdi>
        </span>
        {row.approval_state !== 'none' ? (
          <ApprovalStatePill
            state={row.approval_state}
            signingPath={row.signing_path}
            signedSource={signedSourceOf(row)}
            t={t}
          />
        ) : (
          <>
            <ApprovalStatePill state="none" t={t} />
            {canSubmit ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onSubmit() }}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-[0.72em] font-medium transition-colors min-h-[36px]',
                  'border border-hairline text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  row.category.requires_approval &&
                    'border-warning/50 text-warning hover:border-warning hover:text-warning',
                )}
              >
                <Send className="h-2.5 w-2.5" strokeWidth={2} />
                {row.category.requires_approval
                  ? t('books.approval.needsApproval')
                  : t('books.approval.submitForApproval')}
              </button>
            ) : null}
          </>
        )}
      </div>

      {/* subject */}
      {row.subject ? (
        <p className="line-clamp-2 text-[0.85em] leading-snug text-foreground" dir="auto">
          {row.subject}
        </p>
      ) : null}

      {/* category · direction · date */}
      <div className="flex flex-wrap items-center gap-2 text-[0.72em] text-muted-foreground">
        <span className="inline-flex items-center rounded-full bg-surface-tinted px-2.5 py-0.5 font-medium uppercase tracking-[0.06em]">
          {catLabel}
        </span>
        {row.direction && <DirectionPill direction={row.direction} t={t} />}
        <span className="ms-auto font-mono">{formatDate(row.created_at)}</span>
      </div>
    </article>
  )
}
