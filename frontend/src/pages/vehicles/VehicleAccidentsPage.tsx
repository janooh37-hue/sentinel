/**
 * Accident reports — `/vehicles/accidents`.
 *
 * Read in the Vehicle Services order: the navy band, then the counter that
 * files a new report (pick the vehicle, one large action), then the register.
 * The register is every incident in the fleet, newest first (the order
 * `GET /vehicles/accidents` returns), as dated ledger entries rendered by the
 * same `AccidentCard` the vehicle file's Accidents tab uses, so a report cannot
 * say one thing here and another there.
 *
 * The status tabs are the register's only filter, each with its count. The
 * counts always come from the unfiltered list, so a filter can never hide the
 * number that justifies it. The chosen status lives in the query string, so a
 * filtered register survives a refresh and can be linked to (`?status=open`),
 * while `replace: true` keeps Back pointing at whatever brought the operator
 * here rather than at their previous filter click.
 *
 * The counter is a write: an operator without `vehicles.edit` sees the band and
 * the register only. The request opens as a URL-backed overlay
 * (`?action=accident&vehicle=…`), so Back closes it. Filing clears the filter,
 * because a new report is always open and would otherwise land outside a
 * «Closed» view.
 */

import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { RefreshButton } from '@/components/refresh/RefreshButton'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { VehicleAccidentRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { useUrlOverlay } from '@/lib/urlState'

import { EMPTY_VALUE, VEHICLE_QUERY_KEYS, formatCount } from './vehicleUtils'
import { AccidentLedger } from './components/AccidentCard'
import { AccidentDialog } from './components/AccidentDialog'
import {
  RegisterBar,
  RegisterSheet,
  RegisterTabs,
  ServiceCounter,
  ServicePage,
} from './components/ServiceLayout'

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
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const canEdit = has('vehicles.edit')

  const [searchParams, setSearchParams] = useSearchParams()
  const status = statusFromSearch(searchParams)
  const overlay = useUrlOverlay('action', ['vehicle'])
  const startVehicle = Number(searchParams.get('vehicle')) || null

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
  const vehiclesQuery = useQuery({
    queryKey: [...VEHICLE_QUERY_KEYS.list, {}],
    queryFn: () => api.listVehicles({}),
    enabled: canEdit,
    staleTime: 60_000,
  })

  const accidents = accidentsQuery.data ?? NO_ACCIDENTS
  const openCount = useMemo(
    () => accidents.reduce((sum, row) => (row.status === 'open' ? sum + 1 : sum), 0),
    [accidents],
  )
  const visible = useMemo(
    () => (status === 'all' ? accidents : accidents.filter((row) => row.status === status)),
    [accidents, status],
  )

  /** A count stays `—` until it is known: a zero the API has not confirmed
   *  reads as «nothing is open», which is the opposite of «not loaded yet». */
  const figure = (value: number): string =>
    accidentsQuery.isSuccess ? formatCount(value) : EMPTY_VALUE

  return (
    <ServicePage
      band={{
        back: { to: '/vehicles', label: t('vehicles.backHub') },
        title: t('vehicles.accidentsTitle'),
        description: t('vehicles.accidentsDesc'),
      }}
      counter={
        canEdit ? (
          <ServiceCounter
            artwork="vehicle-accident"
            title={t('vehicles.start.accident')}
            description={t('vehicles.addAccidentDesc')}
            actionLabel={t('vehicles.newReport')}
            vehicles={vehiclesQuery.data}
            onStart={(vehicleId) => overlay.open('accident', { vehicle: String(vehicleId) })}
          />
        ) : null
      }
    >
      {accidentsQuery.isError ? (
        <RegisterSheet>
          <EmptyState
            icon={FileText}
            message={t('common.loadError')}
            actionLabel={t('common.retry')}
            onAction={() => void accidentsQuery.refetch()}
          />
        </RegisterSheet>
      ) : (
        <>
          <RegisterBar>
            <RegisterTabs<StatusFilter>
              label={t('vehicles.status')}
              value={status}
              onChange={selectStatus}
              items={[
                { key: 'all', label: t('vehicles.allStatuses'), count: figure(accidents.length) },
                { key: 'open', label: t('vehicles.openStatus'), count: figure(openCount) },
                {
                  key: 'closed',
                  label: t('vehicles.closedStatus'),
                  count: figure(accidents.length - openCount),
                },
              ]}
            />
            <RefreshButton />
          </RegisterBar>

          {accidentsQuery.isLoading ? (
            <div className="flex flex-col gap-3 border-t-2 border-primary pt-4">
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} className="h-40 w-full" />
              ))}
            </div>
          ) : accidents.length === 0 ? (
            <RegisterSheet>
              {/* Nothing recorded at all: the counter above is the way in. */}
              <EmptyState icon={FileText} message={t('vehicles.noAccidents')} />
            </RegisterSheet>
          ) : visible.length === 0 ? (
            <RegisterSheet>
              {/* Records exist, this status has none — so the way out is the
                  whole register, not a different search. */}
              <EmptyState
                icon={FileText}
                message={t('vehicles.noRecords')}
                description={t('vehicles.adjustFilters')}
                actionLabel={t('vehicles.allStatuses')}
                onAction={() => selectStatus('all')}
              />
            </RegisterSheet>
          ) : (
            <section aria-label={t('vehicles.accidentsTitle')}>
              <AccidentLedger accidents={visible} showVehicle />
              {/* What the list is actually showing, spoken when a filter
                  changes it. */}
              <p aria-live="polite" className="mt-3 text-[0.76em] text-muted-foreground">
                <bdi>{`${formatCount(visible.length)} ${t('vehicles.records')}`}</bdi>
              </p>
            </section>
          )}
        </>
      )}

      {canEdit && overlay.value === 'accident' && (
        <AccidentDialog
          open
          onOpenChange={(open) => {
            if (!open) overlay.close()
          }}
          // Filed from the register, so the vehicle is part of the form.
          vehicle={null}
          initialVehicleId={startVehicle}
          // A new report is open; a «Closed» filter would swallow it.
          onSaved={() => selectStatus('all')}
        />
      )}
    </ServicePage>
  )
}
