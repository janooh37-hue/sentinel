/**
 * ViolationComboField — searchable multi-select combobox for the Warning Form's
 * single `violation_type` field.
 *
 * Presets come from the shared `lib/violationTypes` list (the same 20 types as
 * the Violation Form), grouped by section and filterable. The operator can also
 * type a free-form custom entry not in the list ("Add «query»") — "as many as
 * needed". Selections accumulate as removable chips; no duplicates.
 *
 * Form value = `string[]` — presets are stored by their **canonical Arabic**
 * label (the Warning Form is a fully-Arabic document, so it must render Arabic
 * regardless of the UI language the operator picked in), custom entries verbatim.
 * Chips display via `displayViolationValue` so presets re-translate when the UI
 * language flips. The backend joins the array with the Arabic comma ("، ") into
 * the single `{{ violation_type }}` token.
 *
 * Built on the project's established hand-rolled input+listbox combobox pattern
 * (cf. MultiRecipientPickerField) — no shadcn Command primitive exists in this
 * repo. RTL-correct (text-start / ms-/pe- logical props, dir="auto" on values),
 * reduced-motion-safe (no entrance animation), error display mirrors
 * ViolationCheckboxesField.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { Controller, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

import { Label } from '@/components/ui/label'
import {
  VIOLATION_GROUPS,
  canonicalViolationValue,
  displayViolationValue,
} from '@/lib/violationTypes'
import type { FieldProps } from '../types'

export function ViolationComboField({
  name,
  label_en,
  label_ar,
  required,
}: FieldProps): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const label = isAr ? label_ar : label_en

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const listboxId = useId()
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear any pending blur-close timeout on unmount (avoid setState-after-unmount).
  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current)
    },
    [],
  )

  const {
    control,
    formState: { errors },
  } = useFormContext()

  const error = (errors[name] as { message?: string } | undefined)?.message

  return (
    <div className="col-span-1 sm:col-span-2 flex flex-col gap-1.5">
      <Label htmlFor={`${name}-input`}>
        {label}
        {required && <span className="ms-0.5 text-destructive">*</span>}
      </Label>
      <Controller
        control={control}
        name={name}
        defaultValue={[]}
        render={({ field }) => {
          const selected: string[] = Array.isArray(field.value)
            ? (field.value as string[])
            : []

          // Selection identity is the canonical stored value (preset → Arabic).
          const isSelected = (labelText: string) => {
            const canonical = canonicalViolationValue(labelText).toLowerCase()
            return selected.some((s) => s.toLowerCase() === canonical)
          }

          const add = (labelText: string) => {
            const canonical = canonicalViolationValue(labelText)
            if (!canonical || isSelected(canonical)) return
            field.onChange([...selected, canonical])
          }

          const removeAt = (idx: number) => {
            field.onChange(selected.filter((_, i) => i !== idx))
          }

          const q = query.trim().toLowerCase()

          // Each group's presets, filtered by the query against BOTH languages
          // (operator may search Arabic terms while the UI is English) and with
          // already-chosen entries removed.
          const groups = VIOLATION_GROUPS.map((group) => {
            const items = group.items
              .map((it) => ({ display: isAr ? it.ar : it.en, en: it.en, ar: it.ar }))
              .filter((it) => {
                if (isSelected(it.display)) return false
                if (!q) return true
                return (
                  it.en.toLowerCase().includes(q) ||
                  it.ar.toLowerCase().includes(q)
                )
              })
            return {
              section: isAr ? group.section_ar : group.section_en,
              items,
            }
          }).filter((g) => g.items.length > 0)

          // "Add custom" only when the operator typed something that isn't an
          // exact preset (either language) and isn't already chosen.
          const isPreset = VIOLATION_GROUPS.some((group) =>
            group.items.some(
              (it) => it.en.toLowerCase() === q || it.ar.toLowerCase() === q,
            ),
          )
          const showAddCustom =
            q.length > 0 && !isPreset && !isSelected(query.trim())

          const hasResults = groups.length > 0 || showAddCustom

          return (
            <>
              <div className="relative">
                <input
                  id={`${name}-input`}
                  type="text"
                  role="combobox"
                  aria-expanded={open}
                  aria-controls={open ? listboxId : undefined}
                  aria-autocomplete="list"
                  autoComplete="off"
                  className="flex h-9 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                  placeholder={t('application.violationCombo.placeholder')}
                  value={query}
                  onFocus={() => setOpen(true)}
                  onBlur={() => {
                    // Delay so an onMouseDown selection registers before the
                    // dropdown unmounts.
                    blurTimer.current = setTimeout(() => setOpen(false), 200)
                  }}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    if (!open) setOpen(true)
                  }}
                  onKeyDown={(e) => {
                    // Enter adds the typed custom entry when one is offered.
                    if (e.key === 'Enter' && showAddCustom) {
                      e.preventDefault()
                      add(query.trim())
                      setQuery('')
                    }
                  }}
                />
                {open && (
                  <div
                    id={listboxId}
                    role="listbox"
                    className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-surface py-1 shadow-md"
                  >
                    {!hasResults ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        {t('application.violationCombo.noMatches')}
                      </div>
                    ) : (
                      <>
                        {groups.map((group) => (
                          <div key={group.section}>
                            <div className="px-3 pb-0.5 pt-2 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground rtl:tracking-normal">
                              {group.section}
                            </div>
                            {group.items.map((it) => (
                              <button
                                key={it.en}
                                type="button"
                                role="option"
                                aria-selected={false}
                                dir="auto"
                                className="flex w-full px-3 py-1.5 text-start text-sm hover:bg-muted focus-visible:bg-muted"
                                onMouseDown={(e) => {
                                  e.preventDefault()
                                  add(it.display)
                                  setQuery('')
                                }}
                              >
                                {it.display}
                              </button>
                            ))}
                          </div>
                        ))}
                        {showAddCustom && (
                          <button
                            type="button"
                            role="option"
                            aria-selected={false}
                            className="mt-1 flex w-full items-center gap-1.5 border-t border-hairline px-3 py-1.5 text-start text-sm text-primary hover:bg-muted focus-visible:bg-muted"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              add(query.trim())
                              setQuery('')
                            }}
                          >
                            <span aria-hidden>+</span>
                            <span dir="auto">
                              {t('application.violationCombo.addCustom', {
                                query: query.trim(),
                              })}
                            </span>
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Selected chips */}
              {selected.length > 0 && (
                <ul
                  className="mt-1 flex flex-wrap gap-1.5"
                  aria-label={t('application.violationCombo.selected')}
                >
                  {selected.map((s, idx) => {
                    const display = displayViolationValue(s, isAr)
                    return (
                    <li key={`${s}-${idx}`}>
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft py-1 ps-3 pe-1 text-xs font-medium text-primary">
                        <span className="max-w-[16rem] truncate" dir="auto">
                          {display}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeAt(idx)}
                          aria-label={t('application.violationCombo.remove', {
                            type: display,
                          })}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-primary hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <X className="h-3 w-3" strokeWidth={2} aria-hidden />
                        </button>
                      </span>
                    </li>
                    )
                  })}
                </ul>
              )}
            </>
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
