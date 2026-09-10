import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import type { InmateNationality } from '@/lib/api'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const EMPTY_VALUE = '__none__'


interface NationalityPickerProps {
  loading?: boolean
  loadError?: boolean
  label: string
  value: string
  options: readonly InmateNationality[]
  onChange: (code: string) => void
  disabled?: boolean
  unresolved?: boolean
}

export function NationalityPicker({
  loading = false,
  loadError = false,
  label,
  value,
  options,
  onChange,
  disabled = false,
  unresolved = false,
}: NationalityPickerProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const isAr = i18n.language.startsWith('ar')

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value || EMPTY_VALUE}
        onValueChange={(next) => onChange(next === EMPTY_VALUE ? '' : next)}
        disabled={disabled}
      >
        <SelectTrigger id={id}>
          <SelectValue
            placeholder={
              loading
                ? t('inmateStats.nationalityPicker.loading')
                : loadError
                  ? t('inmateStats.nationalityPicker.loadError')
                  : t('inmateStats.nationalityPicker.placeholder')
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={EMPTY_VALUE}>{t('inmateStats.nationalityPicker.clear')}</SelectItem>
          {options.map((nationality) => (
            <SelectItem key={nationality.code} value={nationality.code}>
              {isAr ? nationality.label_ar : nationality.label_en}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {loadError ? (
        <p role="alert" className="text-xs text-destructive">
          {t('inmateStats.nationalityPicker.loadError')}
        </p>
      ) : null}
      {unresolved && !value ? (
        <p role="alert" className="text-xs text-warning">
          {t('inmateStats.nationalityPicker.unresolved')}
        </p>
      ) : null}
    </div>
  )
}
