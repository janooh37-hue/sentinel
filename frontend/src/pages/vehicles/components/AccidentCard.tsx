/**
 * AccidentCard — one incident, as it appears in the fleet register and in the
 * vehicle file's Accidents tab. One component so the two surfaces cannot
 * disagree about what a report says or what may be done to it.
 *
 * Actions it owns:
 *   * the status badge is the open/closed toggle (`vehicles.edit`)
 *   * «Official letter» leads to the letter page, or «Open letter» to the book
 *     once one has been generated
 *   * delete, behind a confirmation (`vehicles.delete`)
 * Pages gate whether the card is reachable at all; the card still gates its own
 * actions so a viewer never sees a control that would 403.
 */

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, FileText, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api } from '@/lib/api'
import type { VehicleAccidentRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'

import {
  EMPTY_VALUE,
  employeeLabel,
  formatAed,
  formatDateTime,
  invalidateVehicleQueries,
  localized,
  vehicleErrorMessage,
} from '../vehicleUtils'
import { PlateChip } from './PlateChip'
import { VehicleFileThumb } from './VehicleFileViewer'
import { VehicleStatusBadge } from './VehicleStatusBadge'

interface Props {
  accident: VehicleAccidentRead
  /**
   * The register shows which vehicle the report belongs to and offers a way
   * into its file; inside the vehicle file both are redundant.
   */
  showVehicle?: boolean
}

export function AccidentCard({ accident, showVehicle = false }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { has } = useCapabilities()
  const canEdit = has('vehicles.edit')
  const canDelete = has('vehicles.delete')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const setStatus = useMutation({
    mutationFn: (status: VehicleAccidentRead['status']) =>
      api.setAccidentStatus(accident.vehicle_id, accident.id, status),
    onSuccess: () => {
      invalidateVehicleQueries(queryClient, {
        vehicleId: accident.vehicle_id,
        registers: ['accidents'],
      })
      toast.success(t('vehicles.statusUpdated'))
    },
    onError: (err) => toast.error(vehicleErrorMessage(err, t)),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteVehicleAccident(accident.vehicle_id, accident.id),
    onSuccess: () => {
      invalidateVehicleQueries(queryClient, {
        vehicleId: accident.vehicle_id,
        registers: ['accidents'],
      })
      toast.success(t('common.deletedToast'))
    },
    onError: (err) => toast.error(vehicleErrorMessage(err, t)),
  })

  const busy = setStatus.isPending || remove.isPending
  const nextStatus = accident.status === 'open' ? 'closed' : 'open'
  /** What pressing the status badge will do, for its accessible name and its
   *  tooltip — «Closed» alone never says that it is also the control. */
  const statusAction = t(nextStatus === 'closed' ? 'vehicles.markClosed' : 'vehicles.markOpen')
  const photos = accident.photos ?? []
  const driver = employeeLabel(accident, i18n.language, t('vehicles.unassigned'))

  return (
    <article className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-[0.82rem] font-semibold text-foreground">
            {showVehicle && <PlateChip plate={accident.vehicle_plate_label} size="sm" />}
            <span dir="auto">
              {localized(accident.vehicle_type_ar, accident.vehicle_type_en, i18n.language)}
            </span>
          </h3>
          <p className="mt-1 text-[0.69rem] text-muted-foreground">
            <bdi dir="ltr" className="font-mono">
              {formatDateTime(accident.date, accident.time)}
            </bdi>
            {' · '}
            <span dir="auto">{driver}</span>
          </p>
        </div>
        {canEdit ? (
          <VehicleStatusBadge
            family="accident"
            status={accident.status}
            disabled={busy}
            // The visible word stays the current value; the accessible name
            // and the tooltip add the action, and `pressed` publishes the
            // toggle state (a closed report is the settled, pressed one).
            actionLabel={statusAction}
            title={statusAction}
            pressed={accident.status === 'closed'}
            onClick={() => setStatus.mutate(nextStatus)}
          />
        ) : (
          <VehicleStatusBadge family="accident" status={accident.status} />
        )}
      </div>

      <dl className="my-2.5 grid grid-cols-1 gap-2 border-y border-hairline py-2.5 sm:grid-cols-2">
        <Fact label={t('vehicles.location')}>
          <span dir="auto">
            {localized(accident.location_ar, accident.location_en, i18n.language) || EMPTY_VALUE}
          </span>
        </Fact>
        <Fact label={t('vehicles.policeRef')}>
          <bdi dir="ltr" className="font-mono">
            {accident.police_ref || EMPTY_VALUE}
          </bdi>
        </Fact>
        <Fact label={t('vehicles.damageCost')}>
          <bdi>{formatAed(accident.damage_cost, i18n.language)}</bdi>
        </Fact>
        <Fact label={t('vehicles.description')}>
          <span dir="auto">
            {localized(accident.description_ar, accident.description_en, i18n.language) ||
              EMPTY_VALUE}
          </span>
        </Fact>
      </dl>

      {photos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {photos.map((photo) => (
            <VehicleFileThumb
              key={photo.id}
              vehicleId={accident.vehicle_id}
              file={photo}
              siblings={photos}
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {showVehicle && (
          <Link
            to={`/vehicles/${accident.vehicle_id}?tab=accidents`}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            {t('vehicles.open')}
          </Link>
        )}
        {accident.letter_book_id ? (
          <Link
            to={`/books/${accident.letter_book_id}`}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            {t('vehicles.openLetter')}
          </Link>
        ) : (
          canEdit && (
            <Link
              to={`/vehicles/accidents/${accident.id}/letter`}
              className={buttonVariants({ size: 'sm' })}
            >
              <FileText className="h-3.5 w-3.5" aria-hidden />
              {t('vehicles.officialLetter')}
            </Link>
          )
        )}
        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="ms-auto text-muted-foreground hover:text-destructive"
            disabled={busy}
            aria-label={t('vehicles.delete')}
            title={t('vehicles.delete')}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('vehicles.delete')}
        description={t('vehicles.deleteConfirm')}
        confirmLabel={t('vehicles.delete')}
        destructive
        onConfirm={() => remove.mutate()}
      />
    </article>
  )
}

function Fact({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-[0.63rem] uppercase tracking-[0.06em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[0.72rem] font-medium text-foreground">{children}</dd>
    </div>
  )
}
