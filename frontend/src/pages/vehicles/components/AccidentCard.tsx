/**
 * AccidentCard — one incident as a dated ledger entry, in the fleet register
 * and in the vehicle file's Accidents tab. One component so the two surfaces
 * cannot disagree about what a report says or what may be done to it.
 *
 * The date indexes the entry without outweighing the counter above the
 * register; the report reads as written, in whichever language it was filed
 * (`localized` shows the other language's text when the session's is absent).
 * There is no cost on a report: the insurance box says insurance covers the
 * damage, then lists whatever has been recorded about the claim.
 *
 * Actions it owns:
 *   * the status badge is the open/closed toggle (`vehicles.edit`); a report
 *     closes with or without insurance details
 *   * «Official letter» leads to the letter page, or «Open letter» to the book
 *     once one has been generated
 *   * add or edit the insurance details (`vehicles.edit`)
 *   * delete, behind a confirmation (`vehicles.delete`)
 * Pages gate whether the card is reachable at all; the card still gates its own
 * actions so a viewer never sees a control that would 403.
 */

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api } from '@/lib/api'
import type { VehicleAccidentRead } from '@/lib/api'
import { isArabic, localized } from '@/lib/language'
import { toast } from '@/lib/toast'
import { useCapabilities } from '@/lib/useCapabilities'

import {
  EMPTY_VALUE,
  employeeLabel,
  formatCount,
  hasInsurance,
  invalidateVehicleQueries,
  vehicleErrorMessage,
} from '../vehicleUtils'
import { DamageCover, InsuranceDialog, InsuranceFacts } from './AccidentInsurance'
import { PlateChip } from './PlateChip'
import { VehicleFileThumb } from './VehicleFileViewer'
import { VehicleStatusBadge } from './VehicleStatusBadge'
import { VehicleRecordLink } from './VehicleRecordLink'

interface Props {
  accident: VehicleAccidentRead
  /**
   * The register shows which vehicle the report belongs to and offers a way
   * into its file; inside the vehicle file both are redundant.
   */
  showVehicle?: boolean
  /** True on an archived vehicle's file: every mutating control (status
   *  toggle, letter generation, insurance, delete) is hidden, matching the
   *  backend's active-vehicle write guard, even for staff who otherwise hold
   *  the capability. */
  readOnly?: boolean
}

/** «Nov 2026» / «نوفمبر 2026», Latin digits in both languages. */
function monthLabel(iso: string, language: string): string {
  const [year, month] = iso.split('-').map(Number)
  if (!year || !month) return ''
  return new Intl.DateTimeFormat(isArabic(language) ? 'ar-AE-u-nu-latn' : 'en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

/** Reports as a navy-ruled ledger, newest first as the API returns them. */
export function AccidentLedger({
  accidents,
  showVehicle = false,
  readOnly = false,
}: {
  accidents: readonly VehicleAccidentRead[]
  showVehicle?: boolean
  readOnly?: boolean
}): React.JSX.Element | null {
  if (accidents.length === 0) return null
  return (
    <ol className="border-t-2 border-primary">
      {accidents.map((accident) => (
        <li key={accident.id}>
          <AccidentCard accident={accident} showVehicle={showVehicle} readOnly={readOnly} />
        </li>
      ))}
    </ol>
  )
}

export function AccidentCard({
  accident,
  showVehicle = false,
  readOnly = false,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const queryClient = useQueryClient()
  const { has } = useCapabilities()
  const canEdit = has('vehicles.edit') && !readOnly
  const canDelete = has('vehicles.delete') && !readOnly
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [insuranceOpen, setInsuranceOpen] = useState(false)

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
    onError: (err) => toast.error(vehicleErrorMessage(err)),
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
    onError: (err) => toast.error(vehicleErrorMessage(err)),
  })

  const busy = setStatus.isPending || remove.isPending
  const nextStatus = accident.status === 'open' ? 'closed' : 'open'
  /** What pressing the status badge will do, for its accessible name and its
   *  tooltip — «Closed» alone never says that it is also the control. */
  const statusAction = t(nextStatus === 'closed' ? 'vehicles.markClosed' : 'vehicles.markOpen')
  const photos = accident.photos ?? []
  const driver = employeeLabel(accident, lang, t('vehicles.unassigned'))
  const insured = hasInsurance(accident)
  const location = localized(accident.location_ar, accident.location_en, lang) || EMPTY_VALUE
  const description = localized(accident.description_ar, accident.description_en, lang)

  return (
    <article className="grid grid-cols-1 gap-2 border-b border-border py-5 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-5">
      <p className="flex items-baseline gap-2 text-[0.7rem] text-muted-foreground sm:grid sm:content-start sm:justify-items-start sm:gap-0">
        <b className="font-mono text-[1.5rem] font-semibold leading-none text-foreground">
          <bdi dir="ltr">{accident.date.slice(8, 10)}</bdi>
        </b>
        <span className="font-semibold">{monthLabel(accident.date, lang)}</span>
        {accident.time && (
          <small className="font-mono">
            <bdi dir="ltr">{accident.time.slice(0, 5)}</bdi>
          </small>
        )}
      </p>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[0.76rem]">
            {showVehicle && <PlateChip plate={accident.vehicle_plate_label} size="sm" />}
            <h3 className="text-[0.92rem] font-bold text-foreground" dir="auto">
              {localized(accident.vehicle_type_ar, accident.vehicle_type_en, lang)}
            </h3>
            <span className="text-muted-foreground" dir="auto">
              {driver}
            </span>
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

        {description && (
          <p
            className="my-2 w-fit max-w-[min(72ch,100%)] whitespace-pre-line text-[0.95rem] leading-relaxed"
            dir="auto"
          >
            {description}
          </p>
        )}

        <p className="flex flex-wrap gap-x-5 gap-y-1 text-[0.74rem] text-muted-foreground">
          <span>
            {t('vehicles.location')}:{' '}
            <b className="font-semibold text-foreground" dir="auto">
              {location}
            </b>
          </span>
          <span>
            {t('vehicles.policeRef')}:{' '}
            <bdi dir="ltr" className="font-mono text-foreground">
              {accident.police_ref || EMPTY_VALUE}
            </bdi>
          </span>
          <span>
            {t('vehicles.photosLabel')}:{' '}
            <bdi className="font-mono text-foreground">{formatCount(photos.length)}</bdi>
          </span>
        </p>

        {photos.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
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

        <div className="my-3 grid gap-3 rounded-md bg-surface-tinted px-4 py-3">
          <DamageCover />
          <InsuranceFacts accident={accident} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {accident.letter_book_id ? (
            <VehicleRecordLink
              bookId={accident.letter_book_id}
              fallback={<bdi dir="ltr">#{accident.letter_book_id}</bdi>}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {t('vehicles.openLetter')}
            </VehicleRecordLink>
          ) : (
            canEdit && (
              <Link
                to={`/vehicles/accidents/${accident.id}/letter`}
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                <FileText className="h-3.5 w-3.5" aria-hidden />
                {t('vehicles.officialLetter')}
              </Link>
            )
          )}
          {canEdit && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setInsuranceOpen(true)}
            >
              {insured ? (
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Plus className="h-3.5 w-3.5" aria-hidden />
              )}
              {t(insured ? 'vehicles.insurance.edit' : 'vehicles.insurance.add')}
            </Button>
          )}
          {showVehicle && (
            <Link
              to={`/vehicles/${accident.vehicle_id}?tab=accidents`}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              {t('vehicles.vehicleDetail')}
            </Link>
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
      </div>

      {insuranceOpen && (
        <InsuranceDialog open onOpenChange={setInsuranceOpen} accident={accident} />
      )}
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
