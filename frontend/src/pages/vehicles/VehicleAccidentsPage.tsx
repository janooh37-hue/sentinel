/**
 * Accidents register — `/vehicles/accidents`.
 *
 * Every incident in the fleet on one page, newest first (the order
 * `GET /vehicles/accidents` returns), rendered by the same `AccidentCard` the
 * vehicle file's Accidents tab uses — so a report cannot say one thing here and
 * another there, and the card keeps ownership of its own writes: the status
 * toggle, the delete, and the two letter destinations.
 *
 * The status boxes are the register's only filter. They are counts first —
 * «how many are still open» is the reason to come here, and the hub's Accident
 * Report card carries that same figure — and toggles second: pressing one
 * narrows the list to that status, pressing it again returns to the whole
 * register. Both counts always come from the unfiltered list, so a filter can
 * never hide the number that justifies it.
 *
 * The chosen status lives in the query string, so a filtered register survives
 * a refresh and can be linked to (`?status=open`), while `replace: true` keeps
 * Back pointing at whatever brought the operator here rather than at their
 * previous filter click.
 *
 * A new report is filed for any vehicle from here (the dialog offers the
 * fleet); the vehicle file opens the same dialog with the vehicle fixed.
 * Filing clears the filter, because a new report is always open and would
 * otherwise land outside a «Closed» view.
 */

import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { RefreshButton } from '@/components/refresh/RefreshButton'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { VehicleAccidentRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'

import { EMPTY_VALUE, VEHICLE_QUERY_KEYS, formatNumber, isArabic } from './vehicleUtils'
import { AccidentCard } from './components/AccidentCard'
import { AccidentDialog } from './components/AccidentDialog'
import { VehicleStatusBadge } from './components/VehicleStatusBadge'

/** Stable empty list, so a pending or failed fetch does not re-run the
 *  filter memo against a fresh `[]` on every render. */
const NO_ACCIDENTS: readonly VehicleAccidentRead[] = []

/** `all` is the register itself; the other two are the API's own values. */
type StatusFilter = 'all' | VehicleAccidentRead['status']

function statusFromSearch(params: URLSearchParams): StatusFilter {
  const value = params.get('status')
  return value === 'open' || value === 'closed' ? value : 'all'
}

export function VehicleAccidentsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const isAr = isArabic(lang)
  const { has } = useCapabilities()
  const canEdit = has('vehicles.edit')

  const [searchParams, setSearchParams] = useSearchParams()
  const status = statusFromSearch(searchParams)
  const [dialogOpen, setDialogOpen] = useState(false)

  const selectStatus = useCallback(
    (next: StatusFilter) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous)
          if (next === 'all') params.delete('status')
          else params.set('status', next)
          return params
        },
        // Filtering the register is not a navigation step.
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const accidentsQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.accidents,
    queryFn: () => api.listVehicleAccidents(),
  })

  const accidents = accidentsQuery.data ?? NO_ACCIDENTS
  const openCount = useMemo(
    () => accidents.reduce((sum, row) => (row.status === 'open' ? sum + 1 : sum), 0),
    [accidents],
  )
  const closedCount = accidents.length - openCount
  const visible = useMemo(
    () => (status === 'all' ? accidents : accidents.filter((row) => row.status === status)),
    [accidents, status],
  )

  /** A count stays `—` until it is known: a zero the API has not confirmed
   *  reads as «nothing is open», which is the opposite of «not loaded yet». */
  const figure = (value: number): string =>
    accidentsQuery.isSuccess ? formatNumber(value, lang) : EMPTY_VALUE

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <header className="shrink-0 px-4 pb-2 pt-3 md:px-6 md:pb-3 md:pt-5">
        <Link
          to="/vehicles"
          className="inline-flex items-center gap-1.5 text-[0.8em] font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          {isAr ? (
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          )}
          {t('vehicles.backHub')}
        </Link>

        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-foreground md:text-[1.55em]">
              {t('vehicles.accidentsTitle')}
            </h1>
            <p className="mt-1 hidden text-[0.84em] text-muted-foreground md:block">
              {t('vehicles.accidentsDesc')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <RefreshButton />
            {canEdit && (
              <Button type="button" size="sm" onClick={() => setDialogOpen(true)}>
                {t('vehicles.newReport')}
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-24 md:px-6">
        {accidentsQuery.isError ? (
          <div className="rounded-xl border border-border bg-surface">
            <EmptyState
              icon={FileText}
              message={t('common.loadError')}
              actionLabel={t('common.retry')}
              onAction={() => void accidentsQuery.refetch()}
            />
          </div>
        ) : (
          <>
            <div
              role="group"
              aria-label={t('vehicles.status')}
              className="mb-3 flex flex-wrap gap-2"
            >
              <StatusBox
                active={status === 'all'}
                count={figure(accidents.length)}
                onClick={() => selectStatus('all')}
              >
                <span className="text-[0.78em] font-medium text-muted-foreground">
                  {t('vehicles.records')}
                </span>
              </StatusBox>
              <StatusBox
                active={status === 'open'}
                count={figure(openCount)}
                onClick={() => selectStatus(status === 'open' ? 'all' : 'open')}
              >
                <VehicleStatusBadge family="accident" status="open" />
              </StatusBox>
              <StatusBox
                active={status === 'closed'}
                count={figure(closedCount)}
                onClick={() => selectStatus(status === 'closed' ? 'all' : 'closed')}
              >
                <VehicleStatusBadge family="accident" status="closed" />
              </StatusBox>
            </div>

            {accidentsQuery.isLoading ? (
              <div className="grid items-start gap-2.5 xl:grid-cols-2">
                {[0, 1, 2, 3].map((key) => (
                  <Skeleton key={key} className="h-56 w-full rounded-xl" />
                ))}
              </div>
            ) : accidents.length === 0 ? (
              <div className="rounded-xl border border-border bg-surface">
                {/* Nothing recorded at all: the register states the way in
                    rather than the absence. */}
                <EmptyState
                  icon={FileText}
                  message={t('vehicles.noAccidents')}
                  description={canEdit ? t('vehicles.addAccidentDesc') : undefined}
                  actionLabel={canEdit ? t('vehicles.newReport') : undefined}
                  onAction={canEdit ? () => setDialogOpen(true) : undefined}
                />
              </div>
            ) : visible.length === 0 ? (
              <div className="rounded-xl border border-border bg-surface">
                {/* Records exist, this status has none — so the way out is the
                    whole register, not a different search. */}
                <EmptyState
                  icon={FileText}
                  message={t('vehicles.noRecords')}
                  description={t('vehicles.adjustFilters')}
                  actionLabel={t('vehicles.records')}
                  onAction={() => selectStatus('all')}
                />
              </div>
            ) : (
              <section aria-label={t('vehicles.accidentsTitle')}>
                {/* One column on a phone; two on a wide desk, since a report
                    card is compact and the register is long-lived.
                    `items-start` keeps a short report from being stretched to
                    a tall neighbour's height. */}
                <div className="grid items-start gap-2.5 xl:grid-cols-2">
                  {visible.map((accident) => (
                    <AccidentCard key={accident.id} accident={accident} showVehicle />
                  ))}
                </div>
                {/* What the list is actually showing, spoken when a filter
                    changes it. */}
                <p aria-live="polite" className="mt-3 text-[0.76em] text-muted-foreground">
                  <bdi>{`${formatNumber(visible.length, lang)} ${t('vehicles.records')}`}</bdi>
                </p>
              </section>
            )}
          </>
        )}
      </div>

      {dialogOpen && (
        <AccidentDialog
          open
          onOpenChange={setDialogOpen}
          // Filed from the register, so the vehicle is part of the form.
          vehicle={null}
          // A new report is open; a «Closed» filter would swallow it.
          onSaved={() => selectStatus('all')}
        />
      )}
    </div>
  )
}

/**
 * One status box: its own count, and the toggle that narrows the register to
 * it. The state is named by the badge inside (icon + word), never by colour
 * alone, and `aria-pressed` says whether the filter is on.
 */
function StatusBox({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean
  count: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex min-w-0 flex-1 basis-[9rem] items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-start transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'motion-reduce:transition-none',
        active
          ? 'border-primary bg-primary-soft'
          : 'border-border bg-surface hover:border-border-strong',
      )}
    >
      {children}
      <strong className="ms-auto font-mono text-lg font-bold tabular-nums text-primary">
        <bdi>{count}</bdi>
      </strong>
    </button>
  )
}
