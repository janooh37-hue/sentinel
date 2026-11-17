/**
 * AccidentDialog — file an incident report, on its own page beside the
 * official letter it will produce.
 *
 * The report is written in the session's language only: the location and the
 * description go to the `_ar` fields in an Arabic session and to the `_en`
 * fields in an English one, and nothing is asked in the other language. The
 * GSSG-VA letter is Arabic, so an English report gets its Arabic wording on the
 * letter step, once (`VehicleAccidentLetterPage`). The paper beside the form
 * fills in while the operator types; in an English session its location and
 * description say that the Arabic is added when the letter is issued.
 *
 * There is no damage-cost input: insurance covers the damage and the
 * technician estimates the cost. The insurance claim is optional here and can
 * be added later from the register.
 *
 * Photos are uploaded first (`kind=accident`) and the returned ids are what the
 * report is created with, so a failed upload never leaves a report that claims
 * evidence it does not have.
 *
 * Opened from the vehicle file the vehicle is fixed; opened from a counter or
 * the hub it is chosen here, starting on `initialVehicleId`.
 */

import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { z } from 'zod'

import { Field, FieldGrid, FormAlert } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { FileUploadZone } from '@/components/ui/file-upload-zone'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import type { VehicleAccidentRead, VehicleListItem } from '@/lib/api'
import { isArabic, localized } from '@/lib/language'
import { toast } from '@/lib/toast'

import {
  EMPTY_INSURANCE,
  IMAGE_ACCEPT,
  VEHICLE_QUERY_KEYS,
  formatCount,
  insurancePayload,
  invalidateVehicleQueries,
  nowTime,
  plateLabel,
  todayIso,
  vehicleErrorMessage,
  type InsuranceDraft,
} from '../vehicleUtils'
import { AccidentPaper } from './AccidentPaper'
import { DamageCover, InsuranceFields } from './AccidentInsurance'
import { PlateChip } from './PlateChip'
import {
  RequestBody,
  RequestFooter,
  RequestPaperLabel,
  RequestSection,
  RequestShell,
} from './RequestShell'
import { VehicleEmployeeField } from './VehicleEmployeeField'

const schema = z.object({
  vehicle_id: z.string().min(1),
  employee_id: z.string(),
  date: z.string().min(1),
  time: z.string().min(1),
  location: z.string().trim().min(1),
  description: z.string().trim().min(1),
  police_ref: z.string().trim().max(64),
})

type Values = z.output<typeof schema>

/** What the letter shows before the book exists. */
const REF_PLACEHOLDER = 'VA-____'

/** The subset of a vehicle the dialog needs to lock onto one. */
export interface AccidentDialogVehicle {
  id: number
  plate_code?: string | null
  plate_number: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fixed vehicle (vehicle file), or `null` to let the operator choose. */
  vehicle?: AccidentDialogVehicle | null
  /** The vehicle chosen at a counter: where the picker starts. */
  initialVehicleId?: number | null
  onSaved?: (accident: VehicleAccidentRead) => void
}

export function AccidentDialog({
  open,
  onOpenChange,
  vehicle = null,
  initialVehicleId = null,
  onSaved,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  // The form owns the mutation (photo uploads + report); the shell owns
  // dismissal, so the whole sequence is reported up to it as one busy state.
  const [busy, setBusy] = useState(false)
  // The fleet list feeds the picker and, for a fixed vehicle too, the paper
  // (Arabic type, VIN, site).
  const vehiclesQuery = useQuery({
    queryKey: [...VEHICLE_QUERY_KEYS.list, {}],
    queryFn: () => api.listVehicles({}),
    enabled: open,
    staleTime: 60_000,
  })
  const sitesQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.sites,
    queryFn: () => api.listVehicleSites(),
    enabled: open,
    staleTime: 60_000,
  })
  const options = vehiclesQuery.data

  return (
    <RequestShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('vehicles.newReport')}
      description={t('vehicles.addAccidentDesc')}
      busy={busy}
    >
      {options ? (
        <AccidentForm
          locked={vehicle}
          initialVehicleId={initialVehicleId}
          options={options}
          sites={sitesQuery.data ?? []}
          onSaved={onSaved}
          onOpenChange={onOpenChange}
          onBusyChange={setBusy}
        />
      ) : (
        <RequestBody>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </RequestBody>
      )}
    </RequestShell>
  )
}

function AccidentForm({
  locked,
  initialVehicleId,
  options,
  sites,
  onSaved,
  onOpenChange,
  onBusyChange,
}: {
  locked: AccidentDialogVehicle | null
  initialVehicleId: number | null
  options: readonly VehicleListItem[]
  sites: readonly { id: number; name_ar: string; name_en: string }[]
  onSaved?: (accident: VehicleAccidentRead) => void
  onOpenChange: (open: boolean) => void
  onBusyChange: (busy: boolean) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const arabicSession = isArabic(i18n.language)
  const queryClient = useQueryClient()
  const fieldId = useId()
  const alertId = `${fieldId}-alert`

  const [photos, setPhotos] = useState<File[]>([])
  const [insurance, setInsurance] = useState<InsuranceDraft>(EMPTY_INSURANCE)
  const [insuranceOpen, setInsuranceOpen] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const startId =
    locked?.id ??
    (options.some((option) => option.id === initialVehicleId) ? initialVehicleId : null) ??
    options[0]?.id

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<z.input<typeof schema>, unknown, Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      vehicle_id: String(startId ?? ''),
      employee_id: '',
      date: todayIso(),
      time: nowTime(),
      location: '',
      description: '',
      police_ref: '',
    },
  })

  const mutation = useMutation({
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    mutationFn: async (values: Values): Promise<VehicleAccidentRead> => {
      const vehicleId = Number(values.vehicle_id)
      // Evidence first: the report is created with ids that already exist.
      const photoIds: number[] = []
      for (const photo of photos) {
        photoIds.push((await api.uploadVehicleFile(vehicleId, 'accident', photo)).id)
      }
      // One language: the session's.
      return api.createVehicleAccident({
        vehicle_id: vehicleId,
        employee_id: values.employee_id || null,
        date: values.date,
        time: values.time,
        location_ar: arabicSession ? values.location : null,
        location_en: arabicSession ? null : values.location,
        description_ar: arabicSession ? values.description : null,
        description_en: arabicSession ? null : values.description,
        police_ref: values.police_ref || null,
        photo_file_ids: photoIds,
        ...insurancePayload(insurance),
      })
    },
    onSuccess: (accident) => {
      invalidateVehicleQueries(queryClient, {
        vehicleId: accident.vehicle_id,
        registers: ['accidents'],
      })
      toast.success(t('vehicles.accidentFiled'))
      onSaved?.(accident)
      onOpenChange(false)
    },
    onError: (err) => {
      const message = vehicleErrorMessage(err)
      setServerError(message)
      toast.error(message)
    },
  })

  const invalid = Object.keys(errors).length > 0
  const alert = serverError ?? (invalid ? t('vehicles.requiredFields') : null)
  const flag = (
    field: keyof Values,
  ): { 'aria-invalid'?: true; 'aria-describedby'?: string } =>
    errors[field] ? { 'aria-invalid': true, 'aria-describedby': alertId } : {}

  const selectedId = watch('vehicle_id')
  const noVehicles = !locked && options.length === 0
  const current = options.find((option) => String(option.id) === selectedId) ?? null
  const site = sites.find((entry) => entry.id === current?.site_id)
  const employeeId = watch('employee_id')
  const employeeQuery = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => api.getEmployee(employeeId),
    enabled: Boolean(employeeId),
    retry: false,
    staleTime: 60_000,
  })
  const driver = employeeId
    ? employeeQuery.data?.name_ar || employeeQuery.data?.name_en || employeeId
    : null
  const dir = arabicSession ? 'rtl' : 'ltr'

  const paper = (
    <>
      <RequestPaperLabel>{t('vehicles.liveLetter')}</RequestPaperLabel>
      <div className="overflow-x-auto">
        <AccidentPaper
          reference={REF_PLACEHOLDER}
          facts={{
            plateLabel: current ? plateLabel(current) : locked ? plateLabel(locked) : '',
            vehicleTypeAr: current ? current.type_ar || current.type_en : '',
            vin: current?.vin,
            siteAr: site ? site.name_ar || site.name_en : '',
            date: watch('date'),
            time: watch('time'),
            driver,
            // Only Arabic typing reaches the Arabic letter.
            locationAr: arabicSession ? watch('location') : null,
            policeRef: watch('police_ref'),
            status: 'open',
            descriptionAr: arabicSession ? watch('description') : null,
          }}
        />
      </div>
    </>
  )

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      noValidate
      onSubmit={handleSubmit((values) => {
        setServerError(null)
        mutation.mutate(values)
      })}
    >
      <RequestBody aside={paper} asideLabel={t('vehicles.liveLetter')}>
        <FormAlert id={alertId} message={alert} />

        <RequestSection index={1} title={t('vehicles.request.incident')}>
          <FieldGrid>
            {locked ? (
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label id={`${fieldId}-vehicle-label`}>{t('vehicles.selectedVehicle')}</Label>
                <div role="group" aria-labelledby={`${fieldId}-vehicle-label`}>
                  <PlateChip plate={plateLabel(locked)} />
                </div>
              </div>
            ) : (
              <Field
                id={`${fieldId}-vehicle`}
                label={t('vehicles.selectedVehicle')}
                required
                full
                error={noVehicles ? t('vehicles.noVehicles') : undefined}
              >
                <Controller
                  control={control}
                  name="vehicle_id"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={noVehicles}
                    >
                      <SelectTrigger id={`${fieldId}-vehicle`} {...flag('vehicle_id')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((option) => (
                          <SelectItem key={option.id} value={String(option.id)}>
                            <bdi dir="ltr" className="font-mono">
                              {plateLabel(option)}
                            </bdi>
                            {' · '}
                            {localized(option.type_ar, option.type_en, i18n.language)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            )}
            <Field id={`${fieldId}-date`} label={t('vehicles.date')} required>
              <Input
                id={`${fieldId}-date`}
                type="date"
                className="font-mono"
                {...register('date')}
                {...flag('date')}
              />
            </Field>
            <Field id={`${fieldId}-time`} label={t('vehicles.time')} required>
              <Input
                id={`${fieldId}-time`}
                type="time"
                className="font-mono"
                {...register('time')}
                {...flag('time')}
              />
            </Field>
            <Controller
              control={control}
              name="employee_id"
              render={({ field }) => (
                <VehicleEmployeeField
                  employeeId={field.value || null}
                  onChange={(next) => field.onChange(next ?? '')}
                  hint={t('vehicles.unassigned')}
                />
              )}
            />
            <Field id={`${fieldId}-police`} label={t('vehicles.policeRef')}>
              <Input
                id={`${fieldId}-police`}
                dir="ltr"
                className="font-mono"
                {...register('police_ref')}
              />
            </Field>
            <Field id={`${fieldId}-location`} label={t('vehicles.location')} required full>
              <Input
                id={`${fieldId}-location`}
                dir={dir}
                {...register('location')}
                {...flag('location')}
              />
            </Field>
            <Field id={`${fieldId}-desc`} label={t('vehicles.description')} required full>
              <Textarea
                id={`${fieldId}-desc`}
                dir={dir}
                rows={3}
                {...register('description')}
                {...flag('description')}
              />
            </Field>
          </FieldGrid>
        </RequestSection>

        <RequestSection index={2} title={t('vehicles.request.photos')}>
          {photos.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {photos.map((photo, index) => (
                <li
                  key={`${photo.name}-${index}`}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground" dir="auto">
                    {photo.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPhotos((list) => list.filter((_, i) => i !== index))}
                    disabled={mutation.isPending}
                    aria-label={`${t('common.remove')} — ${photo.name}`}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <FileUploadZone
            accept={IMAGE_ACCEPT}
            label={t('vehicles.uploadPhotos')}
            hint={`${t('vehicles.photosHint')} ${t('vehicles.photosLabel')}: ${formatCount(photos.length)}`}
            disabled={mutation.isPending}
            onFile={(file) => setPhotos((list) => [...list, file])}
          />
        </RequestSection>

        <RequestSection
          index={3}
          title={t('vehicles.request.damageInsurance')}
          note={t('vehicles.insurance.optional')}
        >
          <DamageCover />
          {insuranceOpen ? (
            <InsuranceFields
              draft={insurance}
              onChange={setInsurance}
              disabled={mutation.isPending}
            />
          ) : (
            <Button
              type="button"
              variant="link"
              className="h-auto self-start p-0"
              aria-expanded={false}
              onClick={() => setInsuranceOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('vehicles.insurance.add')}
            </Button>
          )}
        </RequestSection>
      </RequestBody>

      <RequestFooter busy={mutation.isPending}>
        <Button
          type="submit"
          size="lg"
          className="sm:min-w-[11rem]"
          disabled={mutation.isPending || !selectedId}
        >
          {mutation.isPending ? t('common.saving') : t('vehicles.save')}
        </Button>
      </RequestFooter>
    </form>
  )
}
