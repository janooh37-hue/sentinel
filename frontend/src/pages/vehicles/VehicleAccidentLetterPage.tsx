/**
 * Official accident letter — `/vehicles/accidents/:accidentId/letter`.
 *
 * One step, because there is nothing to choose: the report already says
 * everything the GSSG-VA paper prints. The page shows the operator the letter
 * it is about to file, then files it.
 *
 * The preview is not decoration — it is built from the same rules as
 * `backend/app/core/vehicle_letters.accident_letter_fields`, in the template's
 * own row order, so what is approved is what the DOCX prints: the plate written
 * with a slash, the Arabic vehicle type, the site's Arabic name, «—» wherever
 * the record has no VIN, no police reference or no driver, the date and time as
 * `dd/mm/yyyy HH:MM`, the damage as «3800 درهم», the status as «مفتوح»/«مغلق»
 * and the Arabic description as the body. The driver line is the employee's
 * name alone: the accident template carries no G-number column.
 *
 * Text the paper itself prints is read with an explicit `lng: 'ar'` — the sheet
 * is an Arabic letterhead document in both UI languages, the contract
 * `PaperSheet` and the fines letter hold. Everything around it follows the UI
 * language.
 *
 * The route carries the accident id and nothing else, so the register list is
 * the resolver: `GET /vehicles/accidents` names the vehicle, and the vehicle
 * file (plus the site list, for the site's Arabic name) is fetched only once
 * that vehicle is known — the same two sources the server reads at generation
 * time, so the paper cannot preview a stale plate or type.
 *
 * A report that already carries a letter is not offered a second one: minting
 * again would file a duplicate book and re-point `letter_book_id` at it. The
 * page then leads to the filed record instead, exactly as the register card
 * does.
 *
 * Saving is a real generation: `POST /vehicles/{id}/accidents/{id}/letter`
 * mints the VA book through the Records pipeline, so the page hands the
 * operator over to `/books/{book_id}`, where the PDF, the print action and the
 * record live. The route only requires `vehicles.view`; generating requires
 * `vehicles.edit`, so the whole page sits behind that capability instead of
 * ending at a Save button the API would refuse.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { RefreshButton } from '@/components/refresh/RefreshButton'
import { RequireCapability } from '@/components/shell/RequireCapability'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { VehicleAccidentRead, VehicleRead, VehicleSiteRead } from '@/lib/api'

import {
  EMPTY_VALUE,
  VEHICLE_QUERY_KEYS,
  formatLetterAed,
  formatLetterDate,
  invalidateVehicleQueries,
  isArabic,
  plateLabel,
  vehicleErrorMessage,
} from './vehicleUtils'
import { PaperFacts, PaperSheet } from './components/PaperSheet'
import { PlateChip } from './components/PlateChip'
import { VehicleFormAlert } from './components/VehicleDialogShell'

/** What the reference line shows before the book exists. The real ref
 *  (`VA-0232`) is minted server-side and announced in the save toast. */
const REF_PLACEHOLDER = 'VA-____'

/** The id of the page's one error region, referenced by the Save button. */
const ERROR_ID = 'accident-letter-error'

export function VehicleAccidentLetterPage(): React.JSX.Element {
  return (
    <RequireCapability cap="vehicles.edit">
      <AccidentLetter />
    </RequireCapability>
  )
}

function AccidentLetter(): React.JSX.Element {
  const { accidentId } = useParams<{ accidentId: string }>()
  // A non-numeric path segment can never be a report: no request is made and
  // the page says so straight away.
  const reportId = accidentId && /^\d+$/.test(accidentId) ? Number(accidentId) : null

  const { t, i18n } = useTranslation()
  const isAr = isArabic(i18n.language)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  // The register list is the only thing that can turn an accident id into a
  // vehicle id, and it is the query the card that linked here already filled.
  const accidentsQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.accidents,
    queryFn: () => api.listVehicleAccidents(),
    enabled: reportId != null,
  })
  const accident = accidentsQuery.data?.find((row) => row.id === reportId) ?? null

  const vehicleQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.detail(accident?.vehicle_id ?? 0),
    queryFn: () => api.getVehicle(accident?.vehicle_id as number),
    enabled: accident != null,
  })
  // The vehicle carries `site_id`; the site's Arabic name — which the letter
  // prints — lives in the site list.
  const sitesQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.sites,
    queryFn: () => api.listVehicleSites(),
    enabled: accident != null,
    staleTime: 60_000,
  })

  const vehicle = vehicleQuery.data
  const sites = sitesQuery.data

  const generate = useMutation({
    mutationFn: () =>
      api.generateAccidentLetter(
        (accident as VehicleAccidentRead).vehicle_id,
        (accident as VehicleAccidentRead).id,
      ),
    onMutate: () => setError(null),
    onSuccess: (result) => {
      // The report now carries `letter_book_id`, and a new book lands in
      // Records and on the dashboard counters.
      invalidateVehicleQueries(queryClient, {
        vehicleId: accident?.vehicle_id,
        registers: ['accidents'],
      })
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(t('vehicles.letterSaved', { ref: result.ref_number }))
      navigate(`/books/${result.book_id}`)
    },
    onError: (err) => {
      const message = vehicleErrorMessage(err, t)
      setError(message)
      toast.error(message)
    },
  })

  const failed = accidentsQuery.isError || vehicleQuery.isError || sitesQuery.isError
  // The list came back and does not contain this id: the report is gone (or
  // the link was hand-written).
  const notFound = reportId == null || (accidentsQuery.isSuccess && accident == null)
  const filedBookId = accident?.letter_book_id ?? null
  /** All three sources answered: the paper can be drawn and can be filed. */
  const ready = accident != null && vehicle != null && sites != null

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <header className="shrink-0 px-4 pb-2 pt-3 md:px-6 md:pb-3 md:pt-5">
        <Link
          to="/vehicles/accidents"
          className="inline-flex items-center gap-1.5 text-[0.8em] font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          {isAr ? (
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          )}
          {t('vehicles.accidentsTitle')}
        </Link>

        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight text-foreground md:text-[1.55em]">
              {t('vehicles.accidentTitle')}
              {accident && (
                <>
                  <span aria-hidden className="text-faint">
                    ·
                  </span>
                  <PlateChip plate={accident.vehicle_plate_label} size="lg" />
                </>
              )}
            </h1>
            <p className="mt-1 hidden text-[0.84em] text-muted-foreground md:block">
              {t('vehicles.accidentLetterDesc')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <RefreshButton />
            {filedBookId != null ? (
              // Already filed: the destination is the record, not a second book.
              <Link to={`/books/${filedBookId}`} className={buttonVariants({ size: 'sm' })}>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                {t('vehicles.openLetter')}
              </Link>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={!ready || generate.isPending}
                aria-describedby={error ? ERROR_ID : undefined}
                onClick={() => generate.mutate()}
              >
                {generate.isPending ? (
                  <Loader2
                    aria-hidden
                    strokeWidth={1.8}
                    className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <FileText className="h-3.5 w-3.5" aria-hidden />
                )}
                {generate.isPending ? t('common.saving') : t('vehicles.saveLetter')}
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-24 md:px-6">
        {notFound ? (
          <section className="rounded-xl border border-border bg-surface">
            <EmptyState
              icon={FileText}
              message={t('vehicles.noAccidents')}
              actionLabel={t('vehicles.accidentsTitle')}
              onAction={() => navigate('/vehicles/accidents')}
            />
          </section>
        ) : failed ? (
          <section className="rounded-xl border border-border bg-surface">
            <EmptyState
              icon={FileText}
              message={t('common.loadError')}
              actionLabel={t('common.retry')}
              onAction={() => {
                if (accidentsQuery.isError) void accidentsQuery.refetch()
                if (vehicleQuery.isError) void vehicleQuery.refetch()
                if (sitesQuery.isError) void sitesQuery.refetch()
              }}
            />
          </section>
        ) : accident == null || vehicle == null || sites == null ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-[32rem] w-full" />
          </div>
        ) : (
          <>
            {filedBookId != null && (
              // Says what happened, and where the filed paper is.
              <p className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-soft px-3.5 py-2.5 text-[0.8em] text-foreground">
                <FileText className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <strong className="font-semibold">{t('vehicles.officialLetter')}</strong>
                <Link
                  to={`/books/${filedBookId}`}
                  className="font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface motion-reduce:transition-none"
                >
                  {t('vehicles.openLetter')}
                </Link>
              </p>
            )}

            <VehicleFormAlert id={ERROR_ID} message={error} />

            <section className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline px-3.5 py-2.5">
                <h2 className="text-[0.95em] font-semibold text-foreground">
                  {t('vehicles.paperPreview')}
                </h2>
                <span className="font-mono text-[0.76em] text-muted-foreground">
                  <bdi dir="ltr">{REF_PLACEHOLDER}</bdi>
                </span>
              </header>
              {/* The sheet keeps its document proportions; a narrow viewport
                  scrolls it rather than reflowing a letter that has one true
                  layout. */}
              <div className="overflow-x-auto p-3">
                <LetterPreview accident={accident} vehicle={vehicle} sites={sites} />
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The paper itself: the GSSG-VA body, row for row.
 *
 * Facts come from the vehicle (plate, Arabic type, VIN, site) and the report
 * (date/time, driver, location, police reference, damage, status) — the same
 * split `vehicle_letter_service.generate_accident_letter` reads them from.
 */
function LetterPreview({
  accident,
  vehicle,
  sites,
}: {
  accident: VehicleAccidentRead
  vehicle: VehicleRead
  sites: readonly VehicleSiteRead[]
}): React.JSX.Element {
  const { t } = useTranslation()
  const ar = (key: string): string => t(key, { lng: 'ar' })

  // The template writes the plate with a slash («10 / 90363»), not with the
  // ledger's backslash.
  const plate = (vehicle.plate_label || plateLabel(vehicle)).replace('\\', '/')
  const site = sites.find((entry) => entry.id === vehicle.site_id)
  const clock = accident.time?.slice(0, 5)
  const dateTime = clock
    ? `${formatLetterDate(accident.date)} ${clock}`
    : formatLetterDate(accident.date)
  // The letter names the driver, never their G-number; an unassigned report
  // prints the dash, exactly as the field builder does.
  const driver = accident.employee_id
    ? accident.employee_name_ar || accident.employee_name_en || EMPTY_VALUE
    : EMPTY_VALUE

  return (
    <PaperSheet reference={REF_PLACEHOLDER} title={ar('vehicles.accidentTitle')}>
      <PaperFacts
        rows={[
          {
            label: ar('vehicles.plate'),
            value: <bdi dir="ltr">{plate}</bdi>,
            mono: true,
          },
          { label: ar('vehicles.type'), value: vehicle.type_ar },
          {
            label: ar('vehicles.vin'),
            value: <bdi dir="ltr">{vehicle.vin || EMPTY_VALUE}</bdi>,
            mono: true,
          },
          { label: ar('vehicles.site'), value: site?.name_ar || EMPTY_VALUE },
          {
            label: ar('vehicles.dateTime'),
            value: <bdi dir="ltr">{dateTime}</bdi>,
            mono: true,
          },
          { label: ar('vehicles.employee'), value: driver },
          { label: ar('vehicles.accidentLocation'), value: accident.location_ar },
          {
            label: ar('vehicles.policeRef'),
            value: <bdi dir="ltr">{accident.police_ref || EMPTY_VALUE}</bdi>,
            mono: true,
          },
          {
            label: ar('vehicles.damageCost'),
            value: formatLetterAed(accident.damage_cost),
          },
          {
            label: ar('vehicles.status'),
            value: ar(
              accident.status === 'open' ? 'vehicles.openStatus' : 'vehicles.closedStatus',
            ),
          },
        ]}
      />

      {/* The template's «الوصف» heading and the Arabic account beneath it —
          the operator's own line breaks preserved, since the DOCX prints the
          text as it was typed. */}
      <h3 className="mb-1.5 mt-4 text-[0.72rem] font-bold">{ar('vehicles.description')}</h3>
      <p className="m-0 whitespace-pre-line border border-[#ddd] bg-white p-2.5 text-[0.66rem] leading-relaxed">
        {accident.description_ar}
      </p>
    </PaperSheet>
  )
}
