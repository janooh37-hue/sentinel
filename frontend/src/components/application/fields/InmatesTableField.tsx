/**
 * InmatesTableField — add/remove row grid for the Inmate Conduct Violations
 * paper. One row per inmate; the docx repeats its template row via
 * `{%tr for i in inmates %}`, so there is no row cap and no blank filler rows.
 *
 * Output shape: `[{name, nationality, wing, uid, holding_no}]` — nationality is
 * always the closed list's canonical Arabic label because the signed 300-005
 * prints this value verbatim.
 *
 * `wing` (الليوان) is a closed list: wings 1–6, sections A and B.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useController, useFieldArray, useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { InmateNationality } from '@/lib/api'
import { resolveNationalityCode } from '@/pages/application/statistics/registerModel'
import { useInmateNationalities } from '@/pages/application/statistics/useInmateRegister'
import type { FieldProps } from '../types'

const EMPTY_UNRESOLVED: readonly boolean[] = []
const EMPTY_NATIONALITIES: readonly InmateNationality[] = []
// The source-document form has no month projection. Generate its fixed schema choices;
// register correction forms receive the server's wing_summary choices instead.
const WINGS = Array.from({ length: 6 }, (_, index) => index + 1).flatMap((floor) => [`${floor}A`, `${floor}B`])

interface Row {
  name: string
  nationality: string
  wing: string
  uid: string
  holding_no: string
}

const blankRow = (): Row => ({ name: '', nationality: '', wing: '', uid: '', holding_no: '' })

interface NationalityComboboxProps {
  fieldName: string
  nationalities: readonly InmateNationality[]
  isLoading: boolean
  isError: boolean
  isAr: boolean
  unresolved: boolean
}

function NationalityCombobox({
  fieldName,
  nationalities,
  isLoading,
  isError,
  isAr,
  unresolved,
}: NationalityComboboxProps): React.JSX.Element {
  const { t } = useTranslation()
  const { control } = useFormContext()
  const { field, fieldState } = useController({ control, name: fieldName })
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const listboxId = useId()
  const unresolvedId = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(
    () => nationalities.find((item) => item.label_ar === field.value) ?? null,
    [field.value, nationalities],
  )
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return nationalities
    return nationalities.filter(
      (item) =>
        item.label_ar.toLowerCase().includes(normalizedQuery) ||
        item.label_en.toLowerCase().includes(normalizedQuery),
    )
  }, [nationalities, query])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
        setActiveIndex(-1)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const commit = (nationality: InmateNationality): void => {
    field.onChange(nationality.label_ar)
    setOpen(false)
    setQuery('')
    setActiveIndex(-1)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        setActiveIndex(filtered.length > 0 ? 0 : -1)
      } else if (filtered.length > 0) {
        setActiveIndex((index) => (index + 1) % filtered.length)
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        setActiveIndex(filtered.length > 0 ? filtered.length - 1 : -1)
      } else if (filtered.length > 0) {
        setActiveIndex((index) => (index <= 0 ? filtered.length - 1 : index - 1))
      }
    } else if (event.key === 'Enter') {
      const active = filtered[activeIndex]
      if (open && active) {
        event.preventDefault()
        commit(active)
      }
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
      setQuery('')
      setActiveIndex(-1)
    }
  }

  const displayValue = selected ? (isAr ? selected.label_ar : selected.label_en) : ''

  return (
    <div ref={rootRef}>
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <input
            type="text"
            role="combobox"
            aria-label={t('inmateStats.nationalityPicker.label')}
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            aria-activedescendant={
              open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
            }
            aria-autocomplete="list"
            aria-invalid={fieldState.invalid || unresolved}
            aria-describedby={unresolved ? unresolvedId : undefined}
            autoComplete="off"
            dir="auto"
            className="flex h-8 w-full rounded-md border border-input bg-surface px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            placeholder={t(
              open
                ? 'inmateStats.nationalityPicker.search'
                : 'inmateStats.nationalityPicker.placeholder',
            )}
            value={open ? query : displayValue}
            onFocus={() => {
              setOpen(true)
              setQuery('')
              setActiveIndex(-1)
            }}
            onBlur={(event) => {
              if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
                setOpen(false)
                setQuery('')
                setActiveIndex(-1)
              }
            }}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(-1)
              if (!open) setOpen(true)
            }}
            onKeyDown={onKeyDown}
          />
          {open && (
            <div
              id={listboxId}
              role="listbox"
              className="mt-1 max-h-56 min-w-64 overflow-auto rounded-md border border-border bg-surface py-1 shadow-md"
            >
              {isLoading ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  {t('inmateStats.nationalityPicker.loading')}
                </div>
              ) : isError ? (
                <div className="px-3 py-2 text-sm text-destructive">
                  {t('inmateStats.nationalityPicker.loadError')}
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  {t('inmateStats.nationalityPicker.empty')}
                </div>
              ) : (
                filtered.map((nationality, index) => (
                  <button
                    key={nationality.code}
                    id={`${listboxId}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={field.value === nationality.label_ar}
                    dir="auto"
                    className={`flex w-full px-3 py-1.5 text-start text-sm hover:bg-muted focus-visible:bg-muted ${
                      index === activeIndex ? 'bg-muted' : ''
                    }`}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      commit(nationality)
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    {isAr ? nationality.label_ar : nationality.label_en}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        {selected && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="h-8 w-8 shrink-0 p-0"
            aria-label={t('inmateStats.nationalityPicker.clear')}
            onClick={() => {
              field.onChange('')
              setQuery('')
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}
      </div>
      {unresolved && (
        <span id={unresolvedId} role="alert" className="mt-1 block text-xs text-destructive">
          {t('inmateStats.nationalityPicker.unresolved')}
        </span>
      )}
    </div>
  )
}

export function InmatesTableField({
  name,
  label_en,
  label_ar,
  required,
}: FieldProps): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const label = isAr ? label_ar : label_en
  const {
    control,
    register,
    setValue,
    formState: { defaultValues, errors },
  } = useFormContext()
  const { fields, append, remove } = useFieldArray({ control, name })
  const rows = useWatch({ control, name }) as Partial<Row>[] | undefined
  const nationalitiesQuery = useInmateNationalities()
  const nationalities = useMemo(
    () =>
      nationalitiesQuery.data?.items.filter((nationality) => nationality.selectable) ??
      EMPTY_NATIONALITIES,
    [nationalitiesQuery.data?.items],
  )
  const canonicalLabels = useMemo(
    () => new Set(nationalities.map((nationality) => nationality.label_ar)),
    [nationalities],
  )
  const nationalitiesByCode = useMemo(
    () => new Map(nationalities.map((nationality) => [nationality.code, nationality])),
    [nationalities],
  )
  // Which rows the bridge could not canonicalise, derived rather than
  // remembered: `reset(reviseFields)` puts the filed payload in RHF's
  // `defaultValues`, so a row whose filed spelling resolves to the `XX`
  // sentinel while its live cell is empty is exactly a row the effect below
  // cleared. The name has to still match, so removing or reordering a row
  // cannot carry the hint onto its neighbour.
  const filedRows = (defaultValues?.[name] ?? undefined) as Partial<Row>[] | undefined
  const unresolvedRows = useMemo(() => {
    const aliases = nationalitiesQuery.data?.aliases
    if (!aliases || !filedRows) return EMPTY_UNRESOLVED
    return fields.map((_, index) => {
      const filed = filedRows[index]
      const filedNationality = (filed?.nationality ?? '').trim()
      if (!filedNationality || (rows?.[index]?.nationality ?? '') !== '') return false
      if ((filed?.name ?? '') !== (rows?.[index]?.name ?? '')) return false
      return resolveNationalityCode(filedNationality, aliases) === 'XX'
    })
  }, [fields, filedRows, nationalitiesQuery.data?.aliases, rows])

  useEffect(() => {
    const aliases = nationalitiesQuery.data?.aliases
    if (!aliases) return
    // A filed value is resolved for display only; the stored payload of an
    // approved paper is never rewritten. An unmatched spelling clears the cell,
    // which the required rule then blocks — the reviser picks by hand.
    fields.forEach((_, index) => {
      const current = rows?.[index]?.nationality
      if (!current?.trim() || canonicalLabels.has(current)) return
      const code = resolveNationalityCode(current, aliases)
      const canonical = code && code !== 'XX' ? nationalitiesByCode.get(code) : undefined
      setValue(`${name}.${index}.nationality`, canonical?.label_ar ?? '', {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      })
    })
  }, [
    canonicalLabels,
    fields,
    name,
    nationalitiesByCode,
    nationalitiesQuery.data?.aliases,
    rows,
    setValue,
  ])

  // Array-level failure ("at least one inmate") lands on `errors[name].message`.
  // Required cell failures land in an array of per-row error objects instead.
  const rawError = errors[name] as
    | { message?: string }
    | ({ name?: { message?: string }; nationality?: { message?: string } } | undefined)[]
    | undefined
  const rowError = Array.isArray(rawError)
    ? rawError.find((row) => row?.name?.message || row?.nationality?.message)
    : undefined
  const error = Array.isArray(rawError)
    ? (rowError?.name?.message ?? rowError?.nationality?.message)
    : rawError?.message

  return (
    <div className="col-span-1 sm:col-span-2 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>
          {label}
          {required && <span className="ms-0.5 text-destructive">*</span>}
        </Label>
        <Button type="button" size="xs" variant="secondary" onClick={() => append(blankRow())}>
          {t('application.inmatesTable.addRow')}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-hairline bg-surface-tinted">
        <table className="w-full border-collapse text-sm [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-2 [&_tbody_tr]:border-t [&_tbody_tr]:border-hairline">
          <thead>
            <tr className="border-b border-hairline text-xs font-semibold tracking-[0.04em] text-muted-foreground [&_th]:text-start">
              <th scope="col" className="w-10">{t('application.inmatesTable.serial')}</th>
              <th scope="col">{t('application.inmatesTable.name')}</th>
              <th scope="col" className="w-28">{t('application.inmatesTable.nationality')}</th>
              <th scope="col" className="w-24">{t('application.inmatesTable.wing')}</th>
              <th scope="col" className="w-32">{t('application.inmatesTable.uid')}</th>
              <th scope="col" className="w-32">{t('application.inmatesTable.holdingNo')}</th>
              <th scope="col" className="w-10" />
            </tr>
          </thead>
          <tbody>
            {fields.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-muted-foreground">
                  {t('application.inmatesTable.empty')}
                </td>
              </tr>
            )}
            {fields.map((row, idx) => (
              <tr key={row.id}>
                <td className="text-center text-muted-foreground">{idx + 1}</td>
                <td>
                  <Input
                    {...register(`${name}.${idx}.name`)}
                    className="h-8 px-2"
                    aria-label={t('application.inmatesTable.name')}
                    dir="auto"
                  />
                </td>
                <td>
                  <NationalityCombobox
                    fieldName={`${name}.${idx}.nationality`}
                    nationalities={nationalities}
                    isLoading={nationalitiesQuery.isLoading}
                    isError={nationalitiesQuery.isError}
                    isAr={isAr}
                    unresolved={unresolvedRows[idx] ?? false}
                  />
                </td>
                <td>
                  <select
                    {...register(`${name}.${idx}.wing`)}
                    aria-label={t('application.inmatesTable.wing')}
                    className="h-8 w-full rounded-md border border-hairline bg-surface px-2 text-sm"
                  >
                    <option value="">{t('application.noSelection')}</option>
                    {WINGS.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <Input
                    {...register(`${name}.${idx}.uid`)}
                    className="h-8 px-2"
                    inputMode="numeric"
                    aria-label={t('application.inmatesTable.uid')}
                    dir="auto"
                  />
                </td>
                <td>
                  <Input
                    {...register(`${name}.${idx}.holding_no`)}
                    className="h-8 px-2"
                    inputMode="numeric"
                    aria-label={t('application.inmatesTable.holdingNo')}
                    dir="auto"
                  />
                </td>
                <td>
                  <Button
                    type="button"
                    size="xs"
                    onClick={() => remove(idx)}
                    aria-label={t('application.inmatesTable.removeRow')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
