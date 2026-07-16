import { Controller, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { FieldProps } from '../types'

interface SelectFieldProps extends FieldProps {
  options: string[]
}

export function SelectField({
  name,
  label_en,
  label_ar,
  required,
  options,
}: SelectFieldProps): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const label = isAr ? label_ar : label_en

  // Options are stored as slugs (the HR Request Form's `doc_selections` — the
  // only field routed here — uses keys like `salary_pay_slip`). Localize each
  // through the hr.docType.* table in both locales; unknown values fall back to
  // the raw slug so nothing renders blank.
  const optionLabel = (opt: string): string =>
    t(`hr.docType.${opt}`, { defaultValue: opt })

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
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
