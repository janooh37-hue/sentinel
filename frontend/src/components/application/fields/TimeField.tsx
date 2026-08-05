/**
 * TimeField — native `<input type="time">`. Mirrors DateField; the browser
 * gives us the locale-correct clock UI for free.
 */

import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FieldProps } from '../types'

export function TimeField({ name, label_en, label_ar, required }: FieldProps): React.JSX.Element {
  const { i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const {
    register,
    formState: { errors },
  } = useFormContext()
  const error = (errors[name] as { message?: string } | undefined)?.message

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>
        {isAr ? label_ar : label_en}
        {required && <span className="ms-0.5 text-destructive">*</span>}
      </Label>
      <Input id={name} type="time" className="font-mono" {...register(name, { required })} />
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
