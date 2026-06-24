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

// Arabic labels for each leave type, keyed by English value
const LEAVE_TYPE_AR: Record<string, string> = {
  Annual: 'إجازة سنوية',
  Sick: 'إجازة مرضية',
  Emergency: 'إجازة طارئة',
  Unpaid: 'إجازة بدون راتب',
  Hajj: 'إجازة حج',
  Maternity: 'إجازة أمومة',
}

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
                  {isAr ? (LEAVE_TYPE_AR[opt] ?? opt) : opt}
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
