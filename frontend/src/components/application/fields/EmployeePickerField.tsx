/**
 * EmployeePickerField — single-employee picker for template forms.
 *
 * Wraps the shared EmployeePicker combobox (full-roster search) and stores
 * the selected employee id (string) under the RHF field `name`.
 *
 * Props follow the shared FieldProps convention so TemplateForm can spread
 * `common` directly.
 */

import { Controller, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import { EmployeePicker } from '@/pages/application/EmployeePicker'
import type { FieldProps } from '../types'

export function EmployeePickerField({
  name,
  label_en,
  label_ar,
  required,
}: FieldProps): React.JSX.Element {
  const { i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const label = isAr ? label_ar : label_en

  const {
    control,
    formState: { errors },
  } = useFormContext()

  const error = (errors[name] as { message?: string } | undefined)?.message

  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        {label}
        {required && <span className="ms-0.5 text-destructive">*</span>}
      </Label>
      <Controller
        control={control}
        name={name}
        rules={{ required }}
        render={({ field }) => (
          <EmployeePicker
            selectedId={(field.value as string | null | undefined) ?? null}
            onSelect={(id) => field.onChange(id)}
          />
        )}
      />
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
