/**
 * Official accident letter — `/vehicles/accidents/:accidentId/letter`.
 *
 * The letter step of a report: the GSSG-VA paper the operator is about to file,
 * beside the one thing that may still be missing. The letter is Arabic; a
 * report written in English has no Arabic location or description yet, so this
 * page asks for them, once, and only when they are missing (each field shows
 * the English wording beneath it). The paper fills in while they are typed.
 * Saving sends the wording with the generation request; the server stores it
 * on the report and files the letter in one step, and refuses the letter
 * while either is still missing.
 *
 * There is no cost on the letter: its damage row prints the insurance
 * sentence (`AccidentPaper`).
 *
 * The route carries the accident id and nothing else, so the register list is
 * the resolver: `GET /vehicles/accidents` names the vehicle, and the vehicle
 * file (plus the site list, for the site's Arabic name) is fetched only once
 * that vehicle is known — the same sources the server reads at generation time.
 *
 * A report that already carries a letter is not offered a second one: minting
 * again would file a duplicate book. The page then leads to the filed record.
 *
 * Saving is a real generation: the VA book is minted through the Records
 * pipeline and the operator is handed to `/books/{book_id}`. Generating
 * requires `vehicles.edit`, so the whole page sits behind that capability.
 */

import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, FileText, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { Field, FieldGrid, FormAlert } from '@/components/forms/DialogShell'
import { RefreshButton } from '@/components/refresh/RefreshButton'
import { RequireCapability } from '@/components/shell/RequireCapability'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import type { VehicleAccidentRead } from '@/lib/api'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

import {
  EMPTY_VALUE,
  VEHICLE_QUERY_KEYS,
  invalidateVehicleQueries,
  plateLabel,
  vehicleErrorMessage,
} from './vehicleUtils'
import { AccidentPaper } from './components/AccidentPaper'
import { PlateChip } from './components/PlateChip'
import { RequestPaperLabel, RequestSection } from './components/RequestShell'
import { ServiceBand } from './components/ServiceLayout'
import { BAND_BUTTON, SERVICE_WRAP } from './components/serviceStyles'
import { VehicleRecordLink } from './components/VehicleRecordLink'

/** What the reference line shows before the book exists. The real ref
 *  (`VA-0232`) is minted server-side and announced in the save toast. */
const REF_PLACEHOLDER = 'VA-____'

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

  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const fieldId = useId()
  const errorId = `${fieldId}-error`
  const [error, setError] = useState<string | null>(null)
  const [locationAr, setLocationAr] = useState('')
  const [descriptionAr, setDescriptionAr] = useState('')
  const [invalid, setInvalid] = useState(false)

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
  const sitesQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.sites,
    queryFn: () => api.listVehicleSites(),
    enabled: accident != null,
    staleTime: 60_000,
  })

  const vehicle = vehicleQuery.data
  const sites = sitesQuery.data
  /** Which Arabic halves the report lacks; only these are asked for. */
  const needsLocation = accident != null && !accident.location_ar?.trim()
  const needsDescription = accident != null && !accident.description_ar?.trim()

  const generate = useMutation({
    mutationFn: (report: VehicleAccidentRead) =>
      api.generateAccidentLetter(report.vehicle_id, report.id, {
        location_ar: needsLocation ? locationAr.trim() : null,
        description_ar: needsDescription ? descriptionAr.trim() : null,
      }),
    onMutate: () => setError(null),
    onSuccess: (result) => {
      // The report now carries `letter_book_id` (and its Arabic wording), and
      // a new book lands in Records and on the dashboard counters.
      invalidateVehicleQueries(queryClient, {
        vehicleId: accident?.vehicle_id,
        registers: ['accidents'],
      })
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(t('vehicles.letterSaved'), { reference: result.ref_number })
      navigate(`/books/${result.book_id}`)
    },
    onError: (err) => {
      const message = vehicleErrorMessage(err)
      setError(message)
      toast.error(message)
    },
  })

  const failed = accidentsQuery.isError || vehicleQuery.isError || sitesQuery.isError
  // The list came back and does not contain this id: the report is gone (or
  // the link was hand-written).
  const notFound = reportId == null || (accidentsQuery.isSuccess && accident == null)
  const filedBookId = accident?.letter_book_id ?? null
  const ready = accident != null && vehicle != null && sites != null
  const asking = filedBookId == null && (needsLocation || needsDescription)
  const locationMissing = needsLocation && !locationAr.trim()
  const descriptionMissing = needsDescription && !descriptionAr.trim()

  const submit = (): void => {
    if (!accident) return
    if (locationMissing || descriptionMissing) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    generate.mutate(accident)
  }

  const site = sites?.find((entry) => entry.id === vehicle?.site_id)
  const driver = accident?.employee_id
    ? accident.employee_name_ar || accident.employee_name_en || EMPTY_VALUE
    : null
  const alert = error ?? (invalid ? t('vehicles.requiredFields') : null)
  const flag = (bad: boolean): { 'aria-invalid'?: true; 'aria-describedby'?: string } =>
    invalid && bad ? { 'aria-invalid': true, 'aria-describedby': errorId } : {}

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ServiceBand
          back={{ to: '/vehicles/accidents', label: t('vehicles.accidentsTitle') }}
          title={
            <>
              {t('vehicles.accidentTitle')}
              {accident && <PlateChip plate={accident.vehicle_plate_label} size="lg" />}
            </>
          }
          description={t('vehicles.accidentLetterDesc')}
          actions={
            filedBookId != null ? (
              // Already filed: the destination is the record, not a second book.
              <VehicleRecordLink bookId={filedBookId} fallback={<bdi dir="ltr">#{filedBookId}</bdi>} className={BAND_BUTTON}>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                {t('vehicles.openLetter')}
              </VehicleRecordLink>
            ) : null
          }
        />

        <div className={cn(SERVICE_WRAP, 'pb-16 pt-6')}>
          {notFound ? (
            <EmptyState
              icon={FileText}
              message={t('vehicles.noAccidents')}
              actionLabel={t('vehicles.accidentsTitle')}
              onAction={() => navigate('/vehicles/accidents')}
            />
          ) : failed ? (
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
          ) : !ready ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-9 w-64" />
              <Skeleton className="h-[32rem] w-full" />
            </div>
          ) : (
            <form
              noValidate
              className={cn(
                'grid items-start gap-8',
                asking && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]',
              )}
              onSubmit={(event) => {
                event.preventDefault()
                submit()
              }}
            >
              {asking && (
                <div className="flex min-w-0 flex-col gap-6">
                  <FormAlert id={errorId} message={alert} />
                  <RequestSection
                    title={t('vehicles.arabicForLetter')}
                    note={t('vehicles.arabicForLetterDesc')}
                  >
                    <FieldGrid>
                      {needsLocation && (
                        <Field
                          id={`${fieldId}-location`}
                          label={t('vehicles.locationAr')}
                          hint={accident.location_en ?? undefined}
                          required
                          full
                        >
                          <Input
                            id={`${fieldId}-location`}
                            dir="rtl"
                            lang="ar"
                            value={locationAr}
                            onChange={(event) => setLocationAr(event.target.value)}
                            {...flag(locationMissing)}
                          />
                        </Field>
                      )}
                      {needsDescription && (
                        <Field
                          id={`${fieldId}-description`}
                          label={t('vehicles.descriptionAr')}
                          hint={accident.description_en ?? undefined}
                          required
                          full
                        >
                          <Textarea
                            id={`${fieldId}-description`}
                            dir="rtl"
                            lang="ar"
                            rows={4}
                            value={descriptionAr}
                            onChange={(event) => setDescriptionAr(event.target.value)}
                            {...flag(descriptionMissing)}
                          />
                        </Field>
                      )}
                    </FieldGrid>
                  </RequestSection>
                </div>
              )}

              <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-6">
                {!asking && <FormAlert id={errorId} message={error} />}
                <div className="flex items-center justify-between gap-2">
                  <RequestPaperLabel>{t('vehicles.liveLetter')}</RequestPaperLabel>
                  <RefreshButton />
                </div>
                <div className="overflow-x-auto">
                  <AccidentPaper
                    reference={REF_PLACEHOLDER}
                    facts={{
                      plateLabel: vehicle.plate_label || plateLabel(vehicle),
                      vehicleTypeAr: vehicle.type_ar || vehicle.type_en,
                      vin: vehicle.vin,
                      siteAr: site ? site.name_ar || site.name_en : EMPTY_VALUE,
                      date: accident.date,
                      time: accident.time,
                      driver,
                      locationAr: needsLocation ? locationAr : accident.location_ar,
                      policeRef: accident.police_ref,
                      status: accident.status,
                      descriptionAr: needsDescription ? descriptionAr : accident.description_ar,
                    }}
                  />
                </div>
                {filedBookId == null && (
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      size="lg"
                      className="w-full sm:w-auto sm:min-w-[11rem]"
                      disabled={generate.isPending}
                      aria-describedby={alert ? errorId : undefined}
                    >
                      {generate.isPending ? (
                        <Loader2
                          aria-hidden
                          strokeWidth={1.8}
                          className="h-4 w-4 animate-spin motion-reduce:animate-none"
                        />
                      ) : (
                        <FileText className="h-4 w-4" aria-hidden />
                      )}
                      {generate.isPending ? t('common.saving') : t('vehicles.saveLetter')}
                    </Button>
                  </div>
                )}
                {filedBookId != null && (
                  <VehicleRecordLink
                    bookId={filedBookId}
                    fallback={<bdi dir="ltr">#{filedBookId}</bdi>}
                    className={cn(buttonVariants({ variant: 'secondary' }), 'self-end')}
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    {t('vehicles.openLetter')}
                  </VehicleRecordLink>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
