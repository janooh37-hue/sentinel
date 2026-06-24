import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { FieldProps } from '../types'

interface TextareaFieldProps extends FieldProps {
  rows?: number
}

export function TextareaField({
  name,
  label_en,
  label_ar,
  required,
  rows = 3,
}: TextareaFieldProps): React.JSX.Element {
  const { i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const label = isAr ? label_ar : label_en

  const {
    register,
    formState: { errors },
  } = useFormContext()

  const error = (errors[name] as { message?: string } | undefined)?.message

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>
        {label}
        {required && <span className="ms-0.5 text-destructive">*</span>}
      </Label>
      <Textarea
        id={name}
        {...register(name)}
        rows={rows}
        dir={isAr ? 'rtl' : undefined}
      />
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
