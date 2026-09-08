/**
 * The vehicle profile field vocabulary — identity, specifications/capacity,
 * licence/insurance, and notes — shared by `AddVehicleDialog` (create) and
 * `VehicleEditPage` (edit). Owns rendering only; the caller owns the
 * mutation, the submit button, and (in edit mode) the photos/licence-scan
 * section, which isn't part of this shared vocabulary.
 */

import { useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { VehicleRead, VehicleSiteRead } from '@/lib/api'

import { CUSTOM_CLASS, NEW_SITE, type VehicleFormInput, type VehicleFormValues } from '../vehicleForm'
import { VEHICLE_CLASSES, licenseWindowEnd, localized } from '../vehicleUtils'
import { VehicleField, VehicleFieldGrid } from './VehicleDialogShell'

export interface VehicleFormFieldsProps {
  form: UseFormReturn<VehicleFormInput, unknown, VehicleFormValues>
  sites: readonly VehicleSiteRead[]
  mode: 'create' | 'edit'
  /** Edit mode only: the record being edited, so the licence section can link
   *  to the existing Renew action instead of letting a date edit masquerade
   *  as a renewal. */
  vehicle?: VehicleRead | null
  fieldIdPrefix: string
  alertId: string
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <VehicleFieldGrid>{children}</VehicleFieldGrid>
    </div>
  )
}

export function VehicleFormFields({
  form,
  sites,
  mode,
  vehicle,
  fieldIdPrefix: fieldId,
  alertId,
}: VehicleFormFieldsProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  // The expiry is derived from the start until the operator sets it himself
  // (create mode only — edit mode never auto-recomputes a stored date).
  const [expiryEdited, setExpiryEdited] = useState(false)
  const {
    register,
    control,
    setValue,
    watch,
    formState: { errors },
  } = form

  const activeSites = sites.filter((site) => site.active)
  const currentSiteId = vehicle?.site_id ?? null
  const currentSiteInactive =
    currentSiteId != null && !sites.find((site) => site.id === currentSiteId)?.active
  const siteChoice = watch('site')
  const newSiteMode = mode === 'create' && siteChoice === NEW_SITE
  const classChoice = watch('vehicle_class')
  const customClassMode = classChoice === CUSTOM_CLASS

  const flag = (
    field: keyof VehicleFormValues,
  ): { 'aria-invalid'?: true; 'aria-describedby'?: string } =>
    errors[field] ? { 'aria-invalid': true, 'aria-describedby': alertId } : {}

  const startField = register('license_start')
  const expiryField = register('license_expiry')

  return (
    <div className="space-y-6">
      <Section title={t('vehicles.sections.identity')}>
        <VehicleField id={`${fieldId}-plate`} label={t('vehicles.plate')} required>
          <Input
            id={`${fieldId}-plate`}
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            placeholder={'10 \\ 36348'}
            className="font-mono"
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
          <Input id={`${fieldId}-vin`} dir="ltr" autoComplete="off" className="font-mono" {...register('vin')} />
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
                  <SelectItem value={CUSTOM_CLASS}>{t('vehicles.customClassOption')}</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </VehicleField>
        {customClassMode && (
          <>
            <VehicleField id={`${fieldId}-class-ar`} label={t('vehicles.customClassAr')} required>
              <Input
                id={`${fieldId}-class-ar`}
                dir="rtl"
                {...register('custom_class_ar')}
                {...flag('custom_class_ar')}
              />
            </VehicleField>
            <VehicleField id={`${fieldId}-class-en`} label={t('vehicles.customClassEn')} required>
              <Input
                id={`${fieldId}-class-en`}
                dir="ltr"
                {...register('custom_class_en')}
                {...flag('custom_class_en')}
              />
            </VehicleField>
          </>
        )}
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
                  {mode === 'edit' && currentSiteInactive && vehicle && (
                    <SelectItem value={String(vehicle.site_id)}>
                      {t('vehicles.currentInactiveSite')}
                    </SelectItem>
                  )}
                  {mode === 'create' && <SelectItem value={NEW_SITE}>{t('vehicles.newSiteOption')}</SelectItem>}
                </SelectContent>
              </Select>
            )}
          />
          {mode === 'edit' && currentSiteInactive && (
            <p className="text-xs text-muted-foreground">
              {t('vehicles.siteInactiveHint')}{' '}
              <Link to="/vehicles" className="underline">
                {t('vehicles.manageSites')}
              </Link>
            </p>
          )}
        </VehicleField>
        {newSiteMode && (
          <>
            <VehicleField id={`${fieldId}-site-ar`} label={t('vehicles.siteNameAr')} required>
              <Input
                id={`${fieldId}-site-ar`}
                dir="rtl"
                {...register('new_site_ar')}
                {...flag('new_site_ar')}
              />
            </VehicleField>
            <VehicleField id={`${fieldId}-site-en`} label={t('vehicles.siteNameEn')} required>
              <Input
                id={`${fieldId}-site-en`}
                dir="ltr"
                {...register('new_site_en')}
                {...flag('new_site_en')}
              />
            </VehicleField>
          </>
        )}
      </Section>

      <Section title={t('vehicles.sections.specs')}>
        <VehicleField id={`${fieldId}-make`} label={t('vehicles.make')}>
          <Input id={`${fieldId}-make`} dir="ltr" {...register('make')} />
        </VehicleField>
        <VehicleField id={`${fieldId}-model`} label={t('vehicles.model')}>
          <Input id={`${fieldId}-model`} dir="ltr" {...register('model')} />
        </VehicleField>
        <VehicleField id={`${fieldId}-model-year`} label={t('vehicles.modelYear')}>
          <Input
            id={`${fieldId}-model-year`}
            dir="ltr"
            inputMode="numeric"
            className="font-mono"
            {...register('model_year')}
            {...flag('model_year')}
          />
        </VehicleField>
        <VehicleField id={`${fieldId}-colour`} label={t('vehicles.colour')}>
          <Input id={`${fieldId}-colour`} dir="ltr" {...register('colour')} />
        </VehicleField>
        <VehicleField id={`${fieldId}-inmate`} label={t('vehicles.inmateCapacity')}>
          <Input
            id={`${fieldId}-inmate`}
            dir="ltr"
            inputMode="numeric"
            className="font-mono"
            {...register('inmate_capacity')}
            {...flag('inmate_capacity')}
          />
        </VehicleField>
        <VehicleField id={`${fieldId}-passenger`} label={t('vehicles.passengerCapacity')}>
          <Input
            id={`${fieldId}-passenger`}
            dir="ltr"
            inputMode="numeric"
            className="font-mono"
            {...register('passenger_capacity')}
            {...flag('passenger_capacity')}
          />
        </VehicleField>
        <VehicleField id={`${fieldId}-accessories-ar`} label={`${t('vehicles.accessories')} · AR`}>
          <Textarea id={`${fieldId}-accessories-ar`} dir="rtl" rows={2} {...register('accessories_ar')} />
        </VehicleField>
        <VehicleField id={`${fieldId}-accessories-en`} label={`${t('vehicles.accessories')} · EN`}>
          <Textarea id={`${fieldId}-accessories-en`} dir="ltr" rows={2} {...register('accessories_en')} />
        </VehicleField>
      </Section>

      <Section title={t('vehicles.sections.licence')}>
        <VehicleField id={`${fieldId}-start`} label={t('vehicles.licenseStart')} required>
          <Input
            id={`${fieldId}-start`}
            type="date"
            className="font-mono"
            {...startField}
            onChange={(event) => {
              void startField.onChange(event)
              if (mode === 'create' && !expiryEdited) {
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
        {mode === 'edit' && vehicle && (
          <p className="col-span-full text-xs text-muted-foreground">
            {t('vehicles.licenseEditHint')}{' '}
            <Link to={`/vehicles/${vehicle.id}`} className="underline">
              {t('vehicles.renewInstead')}
            </Link>
          </p>
        )}
        <VehicleField id={`${fieldId}-insurance`} label={t('vehicles.insuranceExpiry')}>
          <Input
            id={`${fieldId}-insurance`}
            type="date"
            className="font-mono"
            {...register('insurance_expiry')}
          />
        </VehicleField>
      </Section>

      <Section title={t('vehicles.sections.notes')}>
        <VehicleField id={`${fieldId}-contract-note-ar`} label={`${t('vehicles.contractNote')} · AR`}>
          <Textarea
            id={`${fieldId}-contract-note-ar`}
            dir="rtl"
            rows={2}
            className="min-h-[64px]"
            {...register('contract_note_ar')}
          />
        </VehicleField>
        <VehicleField id={`${fieldId}-contract-note-en`} label={`${t('vehicles.contractNote')} · EN`}>
          <Textarea
            id={`${fieldId}-contract-note-en`}
            dir="ltr"
            rows={2}
            className="min-h-[64px]"
            {...register('contract_note_en')}
          />
        </VehicleField>
        <VehicleField id={`${fieldId}-notes-ar`} label={`${t('vehicles.generalNotes')} · AR`}>
          <Textarea id={`${fieldId}-notes-ar`} dir="rtl" rows={2} {...register('notes_ar')} />
        </VehicleField>
        <VehicleField id={`${fieldId}-notes-en`} label={`${t('vehicles.generalNotes')} · EN`}>
          <Textarea id={`${fieldId}-notes-en`} dir="ltr" rows={2} {...register('notes_en')} />
        </VehicleField>
      </Section>
    </div>
  )
}
