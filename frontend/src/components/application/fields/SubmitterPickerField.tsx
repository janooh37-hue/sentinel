/**
 * SubmitterPickerField — select + gear icon to open the submitter manager.
 *
 * Fetches GET /api/v1/submitters via TanStack Query.
 * The gear icon opens SubmitterManagerDialog (stub in chunk F).
 */

import { useEffect, useState } from 'react'
import { Controller, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Settings } from 'lucide-react'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { CapabilityGate } from '@/components/shell/CapabilityGate'
import { api } from '@/lib/api'
import type { SubmitterRead } from '@/lib/api'
import { useIdentity } from '@/lib/useIdentity'
import { SubmitterManagerDialog } from '../SubmitterManagerDialog'
import type { FieldProps } from '../types'

export function SubmitterPickerField({
  name,
  label_en,
  label_ar,
  required,
}: FieldProps): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const label = isAr ? label_ar : label_en

  const [dialogOpen, setDialogOpen] = useState(false)

  const {
    control,
    setValue,
    watch,
    formState: { errors },
  } = useFormContext()

  const { identity } = useIdentity()

  const { data: submitters = [], isLoading, isError: isPickerError } = useQuery<SubmitterRead[]>({
    queryKey: ['submitters'],
    queryFn: () => api.listSubmitters(),
    staleTime: 5 * 60 * 1000,
  })

  // Pre-select the Submitter matching the linked employee. Only fires once
  // when the form has no value AND a matching Submitter row exists.
  const currentValue = watch(name) as string | undefined
  useEffect(() => {
    if (!identity?.linked || !identity.employee_id) return
    if (currentValue) return // user already picked something — don't override
    const match = submitters.find((s) => s.employee_id === identity.employee_id)
    if (match) {
      setValue(name, String(match.id))
    }
  }, [identity, submitters, name, currentValue, setValue])

  const error = (errors[name] as { message?: string } | undefined)?.message

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>
        {label}
        {required && <span className="ms-0.5 text-destructive">*</span>}
      </Label>
      <div className="flex gap-1.5">
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <Select
              value={(field.value as string) || undefined}
              onValueChange={field.onChange}
              disabled={isLoading}
            >
              <SelectTrigger id={name} className="flex-1">
                <SelectValue placeholder={t('application.noSelection')} />
              </SelectTrigger>
              <SelectContent>
                {submitters.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <CapabilityGate cap="submitters.manage" requestable>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setDialogOpen(true)}
            aria-label={t('application.manageSubmitters')}
            title={t('application.manageSubmitters')}
          >
            <Settings className="h-4 w-4" strokeWidth={1.8} />
          </Button>
        </CapabilityGate>
      </div>
      {isPickerError && (
        <span role="alert" className="text-xs text-destructive">
          {t('application.pickerLoadError')}
        </span>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      <SubmitterManagerDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}
