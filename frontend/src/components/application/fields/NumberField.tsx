import { Controller, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FieldProps } from '../types'

export function NumberField({
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
      <Label htmlFor={name}>
        {label}
        {required && <span className="ms-0.5 text-destructive">*</span>}
      </Label>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Input
            id={name}
            type="number"
            value={
              field.value == null || Number.isNaN(field.value as number)
                ? ''
                : (field.value as number | string)
            }
            onChange={(e) => {
              const n = e.target.valueAsNumber
              // A cleared input yields NaN; write `undefined` so the schema sees
              // an absent value (required → caught; optional → skipped) and NaN
              // never reaches the backend.
              field.onChange(Number.isNaN(n) ? undefined : n)
            }}
            className="font-mono"
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
