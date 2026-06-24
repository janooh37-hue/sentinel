/**
 * ReviewerList — presentational list of advisory reviewer steps.
 *
 * Renders each reviewer's name, their current state chip (Awaiting review /
 * Reviewed / Changes requested), a "Seen · date" / "Not seen yet" line, and
 * any note they left. Used in BookDetailDrawer and BookRecordPage.
 */
import type { BookApprovalStepRead } from '@/lib/api'
import { reviewerDescriptor } from '@/pages/books/bookStateLabel'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

export function ReviewerList({
  reviewers,
}: {
  reviewers: BookApprovalStepRead[]
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (reviewers.length === 0) return null

  return (
    <div className="mb-4" data-testid="reviewer-list">
      <h3 className="mb-2.5 text-[0.72em] font-semibold uppercase tracking-wider text-muted-foreground rtl:tracking-normal">
        {t('books.reviewers.title')}
      </h3>
      <ul className="flex flex-col gap-2">
        {reviewers.map((r) => {
          const d = reviewerDescriptor(r.state)
          return (
            <li
              key={r.id}
              data-testid={`reviewer-row-${r.id}`}
              className="rounded-lg border border-hairline bg-surface-tinted px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className="text-[0.82em] font-semibold text-foreground"
                  dir="auto"
                >
                  {r.assignee_name ?? '—'}
                </span>
                <span
                  className={cn(
                    'ms-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7em] font-semibold',
                    d.toneClasses,
                  )}
                >
                  <d.Icon className="h-3 w-3" />
                  {t(d.labelKey)}
                </span>
              </div>
              <p
                className="mt-1 text-[0.72em] text-muted-foreground"
                data-testid={r.seen_at ? `reviewer-seen-${r.id}` : `reviewer-notseen-${r.id}`}
              >
                {r.seen_at
                  ? t('books.reviewers.seenOn', { date: r.seen_at.slice(0, 10) })
                  : t('books.reviewers.notSeen')}
              </p>
              {r.note && (
                <p
                  className="mt-1 rounded-md bg-surface px-2 py-1 text-[0.72em] text-foreground"
                  dir="auto"
                >
                  {r.note}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
