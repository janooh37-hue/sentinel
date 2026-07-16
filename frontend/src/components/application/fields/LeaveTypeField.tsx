import { Controller, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { FieldProps } from '../types'

interface LeaveTypeFieldProps extends FieldProps {
  options: string[]
}

export function LeaveTypeField({
  name,
  label_en,
  label_ar,
  required,
  options,
}: LeaveTypeFieldProps): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const label = isAr ? label_ar : label_en

  // Localize each option through the shared leaves.type.* table (defined for
  // every canonical kind in both locales). Falls back to the stored value if a
  // legacy/unknown option ever arrives, so the field never renders blank.
  const optionLabel = (opt: string): string =>
    t(`leaves.type.${opt}`, { defaultValue: opt })

  const {
    control,
    watch,
    formState: { errors },
  } = useFormContext()

  const currentValue = watch(name) as string | undefined
  const isAnnual = currentValue?.startsWith('Annual') ?? false

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
          <Select
            value={(field.value as string) || undefined}
            onValueChange={field.onChange}
          >
            <SelectTrigger id={name}>
              <SelectValue placeholder={t('application.noSelection')} />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {optionLabel(opt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      {isAnnual && (
        <Badge tone="info" className="self-start">
          {t('application.annualCompanionHint')}
        </Badge>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
