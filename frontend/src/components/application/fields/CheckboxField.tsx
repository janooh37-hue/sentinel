import { Controller, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type { FieldProps } from '../types'

export function CheckboxField({
  name,
  label_en,
  label_ar,
  // `defaultOn` mirrors a submit rule of `value !== false` (checked unless the
  // operator explicitly unticks). The Report sign box uses it so the visible
  // state matches the default-on signing behaviour instead of showing unticked
  // while the report still signs.
  defaultOn = false,
}: FieldProps & { defaultOn?: boolean }): React.JSX.Element {
  const { i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const label = isAr ? label_ar : label_en

  const { control } = useFormContext()

  return (
    <div className="flex items-center gap-2">
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <input
            id={name}
            type="checkbox"
            checked={defaultOn ? field.value !== false : !!field.value}
            onChange={(e) => field.onChange(e.target.checked)}
            className="h-4 w-4 rounded border-input accent-primary"
          />
        )}
      />
      <label
        htmlFor={name}
        className="text-sm text-foreground cursor-pointer select-none"
      >
        {label}
      </label>
    </div>
  )
}
