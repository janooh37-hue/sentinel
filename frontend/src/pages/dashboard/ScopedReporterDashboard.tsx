import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, FilePlus2, FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/ui/empty-state'
import { api, type BookRead, type ScopedRoleName } from '@/lib/api'
import { useRecordDelete } from '@/pages/books/RecordDeleteProvider'
import { StateSeal } from '@/pages/books/StateSeal'
import { useCapabilities } from '@/lib/useCapabilities'

const PAGE_SIZE = 4

type ReportState = 'pending' | 'approved'

function ReportSection({ state, role }: { state: ReportState; role: ScopedRoleName }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const copy = `dashboard.${role === 'fleet_reporter' ? 'fleetReporter' : 'inmateReporter'}`
  const [offset, setOffset] = useState(0)
  const { pendingIds } = useRecordDelete()
  const query = useQuery({
    queryKey: ['books', `${role.replace('_', '-')}-dashboard`, state, offset],
    queryFn: () => api.listBooks({
      approval_state: state, limit: PAGE_SIZE, offset,
      ...(role === 'fleet_reporter' ? { created_by_me: true } : {}),
    }),
  })
  const items = (query.data?.items ?? []).filter((book) => !pendingIds.has(book.id))
  const total = query.data?.total ?? 0
  const titleKey = state === 'pending' ? 'pending' : 'approved'

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {t(`${copy}.${titleKey}`)}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(`${copy}.${titleKey}Hint`)}
          </p>
        </div>
        <span className="rounded-full bg-primary-soft px-3 py-1 font-mono text-sm font-bold text-primary tabular-nums">
          {query.data ? total : '–'}
        </span>
      </header>

      {query.isPending ? (
        <div className="space-y-2 p-4" aria-label={t('common.loading')}>
          {Array.from({ length: PAGE_SIZE }, (_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-xl bg-surface-tinted motion-reduce:animate-none" />
          ))}
        </div>
      ) : query.isError ? (
        <EmptyState
          icon={BookOpen}
          message={t(`${copy}.loadError`)}
          actionLabel={t('common.retry')}
          onAction={() => void query.refetch()}
          className="py-10"
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          message={t(`${copy}.${titleKey}Empty`)}
          className="py-10"
        />
      ) : (
        <ul className="divide-y divide-hairline">
          {items.map((book: BookRead) => (
            <li key={book.id}>
              <Link
                to={`/books/${book.id}`}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs font-bold text-primary" dir="ltr">
                    {book.ref_number}
                  </span>
                  <span className="mt-0.5 block truncate text-sm font-medium text-foreground" dir="auto">
                    {book.subject || t(`${copy}.untitled`)}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {new Date(book.created_at).toLocaleDateString(
                      i18n.language.startsWith('ar') ? 'ar-AE-u-nu-latn' : 'en-GB',
                    )}
                  </span>
                </span>
                <StateSeal state={book.approval_state} signingPath={book.signing_path} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {total > PAGE_SIZE ? (
        <footer className="flex items-center justify-between gap-3 border-t border-hairline px-5 py-3 text-xs">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
            className="rounded-lg px-3 py-2 font-medium text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
          >
            {t('dashboard.inmateReporter.previous')}
          </button>
          <span className="text-muted-foreground">
            {t('dashboard.inmateReporter.pageRange', {
              from: offset + 1,
              to: Math.min(offset + PAGE_SIZE, total),
              total,
            })}
          </span>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((current) => current + PAGE_SIZE)}
            className="rounded-lg px-3 py-2 font-medium text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
          >
            {t('dashboard.inmateReporter.next')}
          </button>
        </footer>
      ) : null}
    </section>
  )
}

export function ScopedReporterDashboard({ role }: { role: ScopedRoleName }): React.JSX.Element {
  const { t } = useTranslation()
  const fleet = role === 'fleet_reporter'
  const { has } = useCapabilities()
  const canViewBooks = !fleet || has('books.view')
  const canCreatePapers = !fleet || has('documents.generate')
  const copy = `dashboard.${fleet ? 'fleetReporter' : 'inmateReporter'}`
  const recordsHref = fleet ? '/books?mine=1' : '/books'
  const ownStatusesId = `${role.replace('_', '-')}-own-statuses`
  const facetsQuery = useQuery({
    queryKey: ['books', 'facets', ...(fleet ? [true] : [])],
    queryFn: () => fleet ? api.getBookFacets({ created_by_me: true }) : api.getBookFacets(),
    enabled: canViewBooks,
  })
  const states = facetsQuery.data?.states ?? {}
  const recordLinks = [
    { state: 'draft', count: states.none ?? 0 },
    { state: 'returned', count: states.returned ?? 0 },
    { state: 'rejected', count: states.rejected ?? 0 },
  ] as const

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="rounded-2xl bg-primary px-6 py-7 text-primary-foreground shadow-sm">
          <p className="text-sm font-medium text-primary-foreground/75">
            {t(`${copy}.eyebrow`)}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            {t(`${copy}.title`)}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-primary-foreground/80">
            {t(`${copy}.subtitle`)}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {canCreatePapers ? <Link
              to="/services"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-surface px-4 py-2.5 text-sm font-semibold text-primary shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transform-none"
            >
              <FilePlus2 className="h-4 w-4" aria-hidden />
              {t(`${copy}.newReport`)}
            </Link> : null}
            {canViewBooks ? <Link
              to={recordsHref}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/30 px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <FolderOpen className="h-4 w-4" aria-hidden />
              {t('dashboard.inmateReporter.records')}
            </Link> : null}
          </div>
        </header>

        {canViewBooks ? <section aria-labelledby={ownStatusesId}>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 id={ownStatusesId} className="text-base font-semibold text-foreground">
                {t(`${copy}.yourReports`)}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t(`${copy}.yourReportsHint`)}
              </p>
            </div>
            <Link to={recordsHref} className="text-sm font-semibold text-primary hover:underline">
              {t('dashboard.inmateReporter.viewAll')}
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {recordLinks.map(({ state, count }) => (
              <Link
                key={state}
                to={`/books?status=${state}${fleet ? '&mine=1' : ''}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-5 py-4 shadow-sm transition-colors hover:border-primary/35 hover:bg-primary-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-sm font-semibold text-foreground">
                  {t(`dashboard.inmateReporter.${state}`)}
                </span>
                <span className="font-mono text-xl font-bold text-primary tabular-nums">
                  {facetsQuery.isSuccess ? count : '–'}
                </span>
              </Link>
            ))}
          </div>
        </section> : null}

        {canViewBooks ? <div className="grid gap-5 lg:grid-cols-2">
          <ReportSection state="pending" role={role} />
          <ReportSection state="approved" role={role} />
        </div> : null}
      </div>
    </div>
  )
}
