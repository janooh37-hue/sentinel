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

import { Controller, useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import { VIOLATION_GROUPS } from '@/lib/violationTypes'
import type { FieldProps } from '../types'

interface SelectedViolation {
  row: number
  name: string
}

/** Sentinel row for the free-text "Others" selection. Never queried by the
 *  printed template (`vio()` only looks at rows 7–28), so it prints nothing in
 *  the violation table; it only satisfies the min-1 rule and shows as "Others"
 *  in the Violation record. The typed detail lands in the companion field. */
const OTHERS_ROW = 0
const OTHERS_NAME = 'Others'

interface ViolationCheckboxesProps extends FieldProps {
  /** Key of the companion free-text field (the Violation Form's `explanation`)
   *  that the "Others" checkbox reveals and feeds. When omitted, no Others UI
   *  is rendered. Supplied by TemplateForm, which absorbs that field so it does
   *  not also render standalone. */
  othersName?: string
}

export function ViolationCheckboxesField({
  name,
  label_en,
  label_ar,
  required,
  othersName,
}: ViolationCheckboxesProps): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const label = isAr ? label_ar : label_en

  const {
    control,
    setValue,
    formState: { errors },
  } = useFormContext()

  // Companion free-text value (empty string when no Others field is wired).
  const othersText = useWatch({
    control,
    name: othersName ?? '__violation_others_unused__',
  }) as string | undefined

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

          // "Others" is open when its sentinel is selected, or (legacy/revise)
          // when the companion field already carries text. Ticking off removes
          // the sentinel AND clears that text so nothing lingers in the cell.
          const othersOpen =
            selectedRows.has(OTHERS_ROW) || Boolean(othersText && othersText.length > 0)
          const toggleOthers = () => {
            if (othersOpen) {
              field.onChange(value.filter((v) => v.row !== OTHERS_ROW))
              if (othersName) setValue(othersName, '', { shouldDirty: true })
            } else {
              field.onChange(
                [...value, { row: OTHERS_ROW, name: OTHERS_NAME }].sort(
                  (a, b) => a.row - b.row,
                ),
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
                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
                          />
                          <span dir="auto" className="leading-snug">
                            {isAr ? v.ar : v.en}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}

              {othersName && (
                <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
                  <label
                    htmlFor={`${name}-others`}
                    className="flex items-start gap-2 text-xs text-foreground cursor-pointer select-none"
                  >
                    <input
                      id={`${name}-others`}
                      type="checkbox"
                      checked={othersOpen}
                      onChange={toggleOthers}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
                    />
                    <span dir="auto" className="leading-snug">
                      {t('application.violationOthers.label')}
                    </span>
                  </label>
                  {othersOpen && (
                    <Controller
                      control={control}
                      name={othersName}
                      defaultValue=""
                      render={({ field: exp }) => (
                        <textarea
                          value={(exp.value as string) ?? ''}
                          onChange={exp.onChange}
                          onBlur={exp.onBlur}
                          rows={2}
                          dir="auto"
                          placeholder={t('application.violationOthers.placeholder')}
                          className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                        />
                      )}
                    />
                  )}
                </div>
              )}
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
