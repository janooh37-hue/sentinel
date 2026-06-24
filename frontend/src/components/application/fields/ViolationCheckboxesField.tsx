/**
 * ViolationCheckboxesField — grid of violation checkboxes.
 *
 * Backend `vio()` helper looks up `data["violations"][i]` where each entry is
 * `{row, time, post, remarks}` and the row index matches the template cell.
 * We emit `[{row, name}]` on toggle — extra fields (time/post/remarks) are
 * optional and currently not collected in the v4 UI.
 *
 * The preset list lives in the shared `lib/violationTypes` module (also used by
 * the Warning Form's combobox). The *displayed* label follows the UI language,
 * but the emitted `name` is always the **English canonical** string — the
 * Violation record relies on it, so only the display text is bilingual. Row
 * indices match the printed Violation Form (GSSG-NAT 300-004).
 */

import { Controller, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import { VIOLATION_GROUPS } from '@/lib/violationTypes'
import type { FieldProps } from '../types'

interface SelectedViolation {
  row: number
  name: string
}

export function ViolationCheckboxesField({
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
    <div className="col-span-1 sm:col-span-2 flex flex-col gap-2">
      <Label>
        {label}
        {required && <span className="ms-0.5 text-destructive">*</span>}
      </Label>
      <Controller
        control={control}
        name={name}
        defaultValue={[]}
        render={({ field }) => {
          const value = (field.value as SelectedViolation[] | undefined) ?? []
          const selectedRows = new Set(value.map((v) => v.row))

          const toggle = (row: number, vname: string) => {
            if (selectedRows.has(row)) {
              field.onChange(value.filter((v) => v.row !== row))
            } else {
              field.onChange(
                [...value, { row, name: vname }].sort((a, b) => a.row - b.row),
              )
            }
          }

          return (
            <div
              className="flex flex-col gap-3 rounded-md border border-hairline bg-surface-tinted p-3"
              role="group"
              aria-labelledby={`${name}-label`}
            >
              {VIOLATION_GROUPS.map((group) => (
                <div key={group.section_en} className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground rtl:tracking-normal">
                    {isAr ? group.section_ar : group.section_en}
                  </span>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {group.items.map((v) => {
                      const id = `${name}-${v.row}`
                      const checked = selectedRows.has(v.row)
                      return (
                        <label
                          key={v.row}
                          htmlFor={id}
                          className="flex items-start gap-2 text-xs text-foreground cursor-pointer select-none"
                        >
                          <input
                            id={id}
                            type="checkbox"
                            checked={checked}
                            // Always emit the English canonical name — the
                            // Violation record depends on it; only the visible
                            // label below is localized.
                            onChange={() => toggle(v.row, v.en)}
                            className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                          />
                          <span dir="auto">{isAr ? v.ar : v.en}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )
        }}
      />
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
