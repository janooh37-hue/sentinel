/**
 * AddVehicleDialog — register a vehicle, its site and its first license.
 *
 * Three requests, in this order, because a file needs a vehicle to belong to:
 *   1. POST /vehicles           — the record (with `new_site` when the operator
 *                                 typed a site instead of picking one)
 *   2. POST /vehicles/{id}/files — the main photo and the license scan
 *   3. PATCH /vehicles/{id}     — point the record at the stored files
 * The success toast fires after the last one. An upload that fails does not
 * discard the vehicle: the record is kept, the dialog closes, and the failure
 * is reported on its own so the operator knows to re-attach the scan from the
 * vehicle file rather than re-registering the vehicle.
 *
 * The plate is one field, written the way the licence prints it (`10 \ 36348`),
 * and split into `plate_code` / `plate_number` on submit.
 */

import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import type { VehicleCreate, VehicleRead, VehicleSiteRead, VehicleUpdate } from '@/lib/api'

import {
  DOCUMENT_ACCEPT,
  IMAGE_ACCEPT,
  VEHICLE_CLASSES,
  VEHICLE_QUERY_KEYS,
  invalidateVehicleQueries,
  licenseWindowEnd,
  localized,
  normalizeDigits,
  parsePlate,
  todayIso,
  vehicleErrorMessage,
} from '../vehicleUtils'
import {
  UploadSlot,
  VehicleDialogBody,
  VehicleDialogFooter,
  VehicleDialogShell,
  VehicleField,
  VehicleFieldGrid,
  VehicleFormAlert,
} from './VehicleDialogShell'

/** Sentinel value of the "+ New site…" option. */
const NEW_SITE = 'new'

const schema = z
  .object({
    plate: z.string().trim().min(1),
    traffic_code: z.string().trim().min(1),
    vin: z.string().trim().max(32),
    type_ar: z.string().trim().min(1).max(128),
    type_en: z.string().trim().min(1).max(128),
    /** Index into `VEHICLE_CLASSES`; the pair is stored, not the index. */
    vehicle_class: z.string().min(1),
    site: z.string().min(1),
    new_site_ar: z.string().trim().max(128),
    new_site_en: z.string().trim().max(128),
    contract_note_ar: z.string().trim().max(2048),
    contract_note_en: z.string().trim().max(2048),
    license_start: z.string().min(1),
    license_expiry: z.string().min(1),
  })
  .superRefine((values, ctx) => {
    if (!parsePlate(values.plate)) {
      ctx.addIssue({ code: 'custom', path: ['plate'], message: 'plate' })
    }
    if (!/^\d{4,12}$/.test(normalizeDigits(values.traffic_code))) {
      ctx.addIssue({ code: 'custom', path: ['traffic_code'], message: 'trafficCode' })
    }
    if (values.license_expiry <= values.license_start) {
      ctx.addIssue({ code: 'custom', path: ['license_expiry'], message: 'expiry' })
    }
    if (values.site === NEW_SITE) {
      if (!values.new_site_ar) {
        ctx.addIssue({ code: 'custom', path: ['new_site_ar'], message: 'required' })
      }
      if (!values.new_site_en) {
        ctx.addIssue({ code: 'custom', path: ['new_site_en'], message: 'required' })
      }
    }
  })

type Values = z.output<typeof schema>

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The stored record, once every request has landed. */
  onSaved?: (vehicle: VehicleRead) => void
}

export function AddVehicleDialog({ open, onOpenChange, onSaved }: Props): React.JSX.Element {
  const { t } = useTranslation()
  // The form owns the mutation, the shell owns dismissal — so the form reports
  // its in-flight state up here, where the shell can refuse Escape and the
  // overlay for the whole create → upload → patch sequence.
  const [busy, setBusy] = useState(false)
  const sitesQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.sites,
    queryFn: () => api.listVehicleSites(),
    enabled: open,
    staleTime: 60_000,
  })
  const sites = sitesQuery.data

  return (
    <VehicleDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('vehicles.addVehicleTitle')}
      description={t('vehicles.addVehicleDesc')}
      size="xl"
      busy={busy}
    >
      {sites ? (
        <AddVehicleForm
          sites={sites}
          onSaved={onSaved}
          onOpenChange={onOpenChange}
          onBusyChange={setBusy}
        />
      ) : (
        <VehicleDialogBody>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-9 w-1/2" />
        </VehicleDialogBody>
      )}
    </VehicleDialogShell>
  )
}

/**
 * Mounted only while the dialog is open (Radix unmounts the content), so every
 * default below is re-applied on each open without a re-seeding effect.
 */
function AddVehicleForm({
  sites,
  onSaved,
  onOpenChange,
  onBusyChange,
}: {
  sites: readonly VehicleSiteRead[]
  onSaved?: (vehicle: VehicleRead) => void
  onOpenChange: (open: boolean) => void
  onBusyChange: (busy: boolean) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const fieldId = useId()
  const alertId = `${fieldId}-alert`
  const activeSites = sites.filter((site) => site.active)

  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [licenseFile, setLicenseFile] = useState<File | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  // The expiry is derived from the start until the operator sets it himself.
  const [expiryEdited, setExpiryEdited] = useState(false)

  const start = todayIso()
  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<z.input<typeof schema>, unknown, Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      plate: '',
      traffic_code: '',
      vin: '',
      type_ar: '',
      type_en: '',
      vehicle_class: '0',
      site: activeSites.length > 0 ? String(activeSites[0].id) : NEW_SITE,
      new_site_ar: '',
      new_site_en: '',
      contract_note_ar: '',
      contract_note_en: '',
      license_start: start,
      license_expiry: licenseWindowEnd(start),
    },
  })

  const siteChoice = watch('site')
  const newSiteMode = siteChoice === NEW_SITE

  const mutation = useMutation({
    mutationFn: async (
      values: Values,
    ): Promise<{ vehicle: VehicleRead; failures: string[] }> => {
      const plate = parsePlate(values.plate)
      // Unreachable: the resolver rejects an unparseable plate before submit.
      if (!plate) throw new Error(t('vehicles.requiredFields'))
      const vehicleClass = VEHICLE_CLASSES[Number(values.vehicle_class)] ?? VEHICLE_CLASSES[0]

      const body: VehicleCreate = {
        plate_code: plate.plate_code,
        plate_number: plate.plate_number,
        traffic_code: normalizeDigits(values.traffic_code),
        type_ar: values.type_ar,
        type_en: values.type_en,
        class_ar: vehicleClass.ar,
        class_en: vehicleClass.en,
        vin: values.vin || null,
        site_id: values.site === NEW_SITE ? null : Number(values.site),
        new_site: values.site === NEW_SITE
          ? { name_ar: values.new_site_ar, name_en: values.new_site_en }
          : null,
        contract_note_ar: values.contract_note_ar || null,
        contract_note_en: values.contract_note_en || null,
        license_start: values.license_start,
        license_expiry: values.license_expiry,
      }

      let vehicle = await api.createVehicle(body)
      const patch: VehicleUpdate = {}
      const failures: string[] = []
      if (photoFile) {
        try {
          patch.photo_file_id = (await api.uploadVehicleFile(vehicle.id, 'photo', photoFile)).id
        } catch (err) {
          failures.push(vehicleErrorMessage(err, t))
        }
      }
      if (licenseFile) {
        try {
          patch.license_file_id = (
            await api.uploadVehicleFile(vehicle.id, 'license', licenseFile)
          ).id
        } catch (err) {
          failures.push(vehicleErrorMessage(err, t))
        }
      }
      if (Object.keys(patch).length > 0) {
        try {
          vehicle = await api.updateVehicle(vehicle.id, patch)
        } catch (err) {
          // The vehicle EXISTS by now; only the file pointers failed to land.
          // Failing the whole mutation here would report "nothing happened"
          // and invite a retry that collides with the plate just registered
          // (PLATE_EXISTS). So the record is reported as saved, the unlinked
          // attachment as the one failure, and the caches are refreshed either
          // way — the operator re-attaches from the vehicle file.
          failures.push(vehicleErrorMessage(err, t))
        }
      }
      return { vehicle, failures }
    },
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: ({ vehicle, failures }) => {
      invalidateVehicleQueries(queryClient, { vehicleId: vehicle.id, registers: ['sites'] })
      toast.success(t('vehicles.vehicleAdded'))
      for (const failure of failures) toast.error(failure)
      onSaved?.(vehicle)
      onOpenChange(false)
    },
    onError: (err) => {
      const message = vehicleErrorMessage(err, t)
      setServerError(message)
      toast.error(message)
    },
  })

  const invalid = Object.keys(errors).length > 0
  const alert = serverError ?? (invalid ? t('vehicles.requiredFields') : null)
  /** Marks a control invalid and points it at the one error region. */
  const flag = (
    field: keyof Values,
  ): { 'aria-invalid'?: true; 'aria-describedby'?: string } =>
    errors[field] ? { 'aria-invalid': true, 'aria-describedby': alertId } : {}

  const startField = register('license_start')
  const expiryField = register('license_expiry')

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={handleSubmit((values) => {
        setServerError(null)
        mutation.mutate(values)
      })}
    >
      <VehicleDialogBody>
        <VehicleFormAlert id={alertId} message={alert} />
        <VehicleFieldGrid>
          <VehicleField id={`${fieldId}-plate`} label={t('vehicles.plate')} required>
            <Input
              id={`${fieldId}-plate`}
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              placeholder={'10 \\ 36348'}
              className="font-mono"
              autoFocus
              {...register('plate')}
              {...flag('plate')}
            />
          </VehicleField>
          <VehicleField id={`${fieldId}-traffic`} label={t('vehicles.trafficCode')} required>
            <Input
              id={`${fieldId}-traffic`}
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              className="font-mono"
              {...register('traffic_code')}
              {...flag('traffic_code')}
            />
          </VehicleField>
          <VehicleField id={`${fieldId}-vin`} label={t('vehicles.vin')} full>
            <Input
              id={`${fieldId}-vin`}
              dir="ltr"
              autoComplete="off"
              className="font-mono"
              {...register('vin')}
            />
          </VehicleField>
          <VehicleField id={`${fieldId}-type-ar`} label={t('vehicles.typeAr')} required>
            <Input id={`${fieldId}-type-ar`} dir="rtl" {...register('type_ar')} {...flag('type_ar')} />
          </VehicleField>
          <VehicleField id={`${fieldId}-type-en`} label={t('vehicles.typeEn')} required>
            <Input id={`${fieldId}-type-en`} dir="ltr" {...register('type_en')} {...flag('type_en')} />
          </VehicleField>
          <VehicleField id={`${fieldId}-class`} label={t('vehicles.class')}>
            <Controller
              control={control}
              name="vehicle_class"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={`${fieldId}-class`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VEHICLE_CLASSES.map((option, index) => (
                      <SelectItem key={option.en} value={String(index)}>
                        {localized(option.ar, option.en, i18n.language)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </VehicleField>
          <VehicleField id={`${fieldId}-site`} label={t('vehicles.site')} required>
            <Controller
              control={control}
              name="site"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={`${fieldId}-site`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {activeSites.map((site) => (
                      <SelectItem key={site.id} value={String(site.id)}>
                        {localized(site.name_ar, site.name_en, i18n.language)}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_SITE}>{t('vehicles.newSiteOption')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </VehicleField>
          {newSiteMode && (
            <>
              <VehicleField
                id={`${fieldId}-site-ar`}
                label={t('vehicles.siteNameAr')}
                required
              >
                <Input
                  id={`${fieldId}-site-ar`}
                  dir="rtl"
                  {...register('new_site_ar')}
                  {...flag('new_site_ar')}
                />
              </VehicleField>
              <VehicleField
                id={`${fieldId}-site-en`}
                label={t('vehicles.siteNameEn')}
                required
              >
                <Input
                  id={`${fieldId}-site-en`}
                  dir="ltr"
                  {...register('new_site_en')}
                  {...flag('new_site_en')}
                />
              </VehicleField>
            </>
          )}
          <VehicleField id={`${fieldId}-start`} label={t('vehicles.licenseStart')} required>
            <Input
              id={`${fieldId}-start`}
              type="date"
              className="font-mono"
              {...startField}
              onChange={(event) => {
                void startField.onChange(event)
                if (!expiryEdited) {
                  setValue('license_expiry', licenseWindowEnd(event.target.value))
                }
              }}
              {...flag('license_start')}
            />
          </VehicleField>
          <VehicleField id={`${fieldId}-expiry`} label={t('vehicles.licenseExpiry')} required>
            <Input
              id={`${fieldId}-expiry`}
              type="date"
              className="font-mono"
              {...expiryField}
              onChange={(event) => {
                void expiryField.onChange(event)
                setExpiryEdited(true)
              }}
              {...flag('license_expiry')}
            />
          </VehicleField>
          <VehicleField
            id={`${fieldId}-note-ar`}
            label={`${t('vehicles.contractNote')} · AR`}
          >
            <Textarea
              id={`${fieldId}-note-ar`}
              dir="rtl"
              rows={2}
              className="min-h-[64px]"
              {...register('contract_note_ar')}
            />
          </VehicleField>
          <VehicleField
            id={`${fieldId}-note-en`}
            label={`${t('vehicles.contractNote')} · EN`}
          >
            <Textarea
              id={`${fieldId}-note-en`}
              dir="ltr"
              rows={2}
              className="min-h-[64px]"
              {...register('contract_note_en')}
            />
          </VehicleField>
        </VehicleFieldGrid>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <UploadSlot
            label={t('vehicles.uploadPhoto')}
            accept={IMAGE_ACCEPT}
            file={photoFile}
            onFile={setPhotoFile}
            onClear={() => setPhotoFile(null)}
            disabled={mutation.isPending}
            clearLabel={t('common.remove')}
          />
          <UploadSlot
            label={t('vehicles.licenseScan')}
            accept={DOCUMENT_ACCEPT}
            file={licenseFile}
            onFile={setLicenseFile}
            onClear={() => setLicenseFile(null)}
            disabled={mutation.isPending}
            clearLabel={t('common.remove')}
          />
        </div>
      </VehicleDialogBody>

      <VehicleDialogFooter>
        <Button
          type="button"
          variant="ghost"
          disabled={mutation.isPending}
          onClick={() => onOpenChange(false)}
        >
          {t('vehicles.cancel')}
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t('common.saving') : t('vehicles.save')}
        </Button>
      </VehicleDialogFooter>
    </form>
  )
}
