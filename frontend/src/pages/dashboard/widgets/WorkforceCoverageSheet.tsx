import { useEffect, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, CircleAlert, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { api, type WorkforceCoverageRow } from '@/lib/api'

interface CoverageSelection {
  department: string | null
  dutyUnit: string | null
}

const INITIAL_SELECTION: CoverageSelection = { department: null, dutyUnit: null }

export interface WorkforceCoverageSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  operationalDate: string
}

export function WorkforceCoverageSheet({
  open,
  onOpenChange,
  operationalDate,
}: WorkforceCoverageSheetProps): React.JSX.Element {
  const { t } = useTranslation()
  const [selection, setSelection] = useState<CoverageSelection>(INITIAL_SELECTION)
  const parentKind = selection.department == null
    ? 'organization'
    : selection.dutyUnit == null
      ? 'department'
      : 'duty_unit'

  useEffect(() => {
    if (!open) setSelection(INITIAL_SELECTION)
  }, [open])

  const coverageQuery = useInfiniteQuery({
    queryKey: ['workforce', 'coverage', operationalDate, parentKind, selection.department, selection.dutyUnit],
    queryFn: ({ pageParam }) =>
      api.getWorkforceCoverage({
        operational_date: operationalDate,
        parent_kind: parentKind,
        ...(selection.department == null ? {} : { department: selection.department }),
        ...(selection.dutyUnit == null ? {} : { duty_unit: selection.dutyUnit }),
        ...(pageParam == null ? {} : { cursor: pageParam }),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: open,
    staleTime: 60_000,
  })

  const rows = coverageQuery.data?.pages.flatMap((page) => page.items) ?? []
  const levelTitle = t(`dashboard.workforcePulse.coverage.level.${parentKind}`)
  const canGoBack = selection.department != null

  const selectRow = (row: WorkforceCoverageRow) => {
    if (parentKind === 'organization' && row.department) {
      setSelection({ department: row.department, dutyUnit: null })
    } else if (parentKind === 'department' && row.duty_unit) {
      setSelection({ department: selection.department, dutyUnit: row.duty_unit })
    }
  }

  const goBack = () => {
    if (selection.dutyUnit != null) setSelection((current) => ({ ...current, dutyUnit: null }))
    else setSelection(INITIAL_SELECTION)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setSelection(INITIAL_SELECTION)
    onOpenChange(nextOpen)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent aria-describedby={undefined} className="w-screen max-w-none bg-surface p-0 md:w-[42rem] md:max-w-[92vw]">
        <div className="flex h-full min-h-0 flex-col" dir="auto">
          <header className="flex-none border-b border-hairline px-4 py-3.5 sm:px-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} aria-hidden />
                  <SheetTitle className="text-base font-semibold text-foreground">
                    {t('dashboard.workforcePulse.coverage.title')}
                  </SheetTitle>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('dashboard.workforcePulse.coverage.operationalDate', { date: operationalDate })}
                </p>
              </div>
              <SheetClose
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t('common.close', { defaultValue: 'Close' })}
              >
                <span aria-hidden>×</span>
              </SheetClose>
            </div>
          </header>

          <div className="flex flex-none items-center gap-2 border-b border-hairline px-4 py-2.5 sm:px-5">
            {canGoBack ? (
              <Button type="button" variant="ghost" size="sm" onClick={goBack} className="shrink-0 gap-1.5">
                <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
                {t('dashboard.workforcePulse.coverage.back')}
              </Button>
            ) : null}
            <nav aria-label={t('dashboard.workforcePulse.coverage.breadcrumb')} className="min-w-0 overflow-x-auto">
              <ol className="flex min-w-max items-center gap-1 text-sm">
                <li>
                  <button
                    type="button"
                    onClick={() => setSelection(INITIAL_SELECTION)}
                    aria-current={selection.department == null ? 'page' : undefined}
                    className="rounded px-1.5 py-1 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('dashboard.workforcePulse.coverage.allDepartments')}
                  </button>
                </li>
                {selection.department != null ? (
                  <li className="flex items-center gap-1" key={selection.department}>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
                    <button
                      type="button"
                      onClick={() => setSelection((current) => ({ ...current, dutyUnit: null }))}
                      aria-current={selection.dutyUnit == null ? 'page' : undefined}
                      className="rounded px-1.5 py-1 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {selection.department}
                    </button>
                  </li>
                ) : null}
                {selection.dutyUnit != null ? (
                  <li className="flex items-center gap-1" key={selection.dutyUnit}>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
                    <span className="px-1.5 py-1 font-medium text-foreground" aria-current="page">{selection.dutyUnit}</span>
                  </li>
                ) : null}
              </ol>
            </nav>
          </div>

          <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5" aria-live="polite">
            <p className="mb-3 font-mono text-[0.7em] font-semibold uppercase tracking-wide text-muted-foreground">{levelTitle}</p>
            {coverageQuery.isPending ? (
              <div className="space-y-3" aria-label={t('common.loading')}>
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : coverageQuery.isError ? (
              <EmptyState icon={CircleAlert} message={t('common.loadError')} className="py-12" />
            ) : rows.length === 0 ? (
              <EmptyState icon={Users} message={t('dashboard.workforcePulse.coverage.empty')} className="py-12" />
            ) : (
              <div className="space-y-3">
                <ul className="space-y-2" aria-label={levelTitle}>
                  {rows.map((row, index) => {
                    const identifier = rowName(row)
                    const name = identifier?.trim() || t('dashboard.workforcePulse.coverage.unassigned')
                    const isNavigable = Boolean(identifier?.trim()) && parentKind !== 'duty_unit' && row.child_count > 0
                    return (
                      <li key={`${row.kind}:${identifier ?? 'unassigned'}:${index}`} className="rounded-xl border border-hairline bg-surface-raised">
                        {isNavigable ? (
                          <button
                            type="button"
                            aria-label={name}
                            onClick={() => selectRow(row)}
                            className="block w-full rounded-xl p-3.5 text-start transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4"
                          >
                            <CoverageRow row={row} name={name} expandable />
                          </button>
                        ) : (
                          <div className="p-3.5 sm:p-4"><CoverageRow row={row} name={name} /></div>
                        )}
                      </li>
                    )
                  })}
                </ul>
                {coverageQuery.hasNextPage ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => void coverageQuery.fetchNextPage()}
                    disabled={coverageQuery.isFetchingNextPage}
                  >
                    {coverageQuery.isFetchingNextPage
                      ? t('common.loading')
                      : t('dashboard.workforcePulse.coverage.loadMore')}
                  </Button>
                ) : null}
              </div>
            )}
          </main>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function rowName(row: WorkforceCoverageRow): string | null {
  return row.kind === 'department' ? row.department : row.kind === 'duty_unit' ? row.duty_unit : row.duty_post
}

function CoverageRow({ row, name, expandable = false }: { row: WorkforceCoverageRow; name: string; expandable?: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const gap = row.working == null ? null : Math.max(row.expected - row.working, 0)
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-semibold text-foreground">{name}</span>
        {expandable ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden /> : null}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
        <Metric label={t('dashboard.workforcePulse.coverage.metrics.scheduled')} value={row.scheduled} />
        <Metric label={t('dashboard.workforcePulse.coverage.metrics.excused')} value={row.excused} />
        <Metric label={t('dashboard.workforcePulse.coverage.metrics.expected')} value={row.expected} />
        <Metric label={t('dashboard.workforcePulse.coverage.metrics.evaluated')} value={row.evaluated_count} />
        <Metric label={t('dashboard.workforcePulse.coverage.metrics.excluded')} value={row.pending_or_error_excluded_count} />
        <Metric label={t('dashboard.workforcePulse.coverage.metrics.working')} value={row.working == null ? t('dashboard.workforcePulse.coverage.pendingVerification') : row.working} />
        {gap != null ? <Metric label={t('dashboard.workforcePulse.coverage.metrics.gap')} value={gap} /> : null}
      </dl>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }): React.JSX.Element {
  return (
    <div>
      <dt className="font-mono text-[0.68em] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  )
}
