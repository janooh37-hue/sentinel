import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FieldProps } from '../types'

interface TextFieldProps extends FieldProps {
  placeholder?: string
}

export function TextField({
  name,
  label_en,
  label_ar,
  required,
  placeholder,
}: TextFieldProps): React.JSX.Element {
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
      <Input
        id={name}
        {...register(name)}
        placeholder={placeholder}
        // Short single-line form fields (account number, IBAN, bank name, …)
        // are never legitimately this long; cap the input so 5000-char garbage
        // can't reach the DOCX token / DB. Long prose lives in TextareaField,
        // which is intentionally uncapped.
        maxLength={200}
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
