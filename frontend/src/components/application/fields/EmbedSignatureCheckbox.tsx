/**
 * EmbedSignatureCheckbox — boolean checkbox bound to
 * `embed_signature.manager` or `embed_signature.employee`. The `name` prop
 * must be the full dotted RHF path (e.g. "embed_signature.manager").
 *
 * Round 2 — Fix E: renamed from HandSignCheckbox with inverted semantics.
 * Previously: checked = "I'll sign by hand" (no embed). Now: checked = "embed
 * my saved signature". Default unchecked → no embed → operator signs by hand.
 */

import { Controller, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type { FieldProps } from '../types'

export function EmbedSignatureCheckbox({
  name,
  label_en,
  label_ar,
}: FieldProps): React.JSX.Element {
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
            checked={!!field.value}
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
