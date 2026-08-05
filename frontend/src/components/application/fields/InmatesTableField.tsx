/**
 * InmatesTableField — add/remove row grid for the Inmate Conduct Violations
 * paper. One row per inmate; the docx repeats its template row via
 * `{%tr for i in inmates %}`, so there is no row cap and no blank filler rows.
 *
 * Output shape: `[{name, nationality, wing, uid, holding_no}]` — the key names
 * are the template's loop variables and must not be renamed on one side only.
 *
 * `wing` (الليوان) is a closed list: wings 1–6, sections A and B.
 */

import { useFieldArray, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FieldProps } from '../types'

/** الليوان — 6 wings × sections A/B. */
const WINGS: readonly string[] = [1, 2, 3, 4, 5, 6].flatMap((n) => [`${n}A`, `${n}B`])

interface Row {
  name: string
  nationality: string
  wing: string
  uid: string
  holding_no: string
}

const blankRow = (): Row => ({ name: '', nationality: '', wing: '', uid: '', holding_no: '' })

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
    formState: { errors },
  } = useFormContext()
  const { fields, append, remove } = useFieldArray({ control, name })
  // Array-level failure ("at least one inmate") lands on `errors[name].message`.
  // A per-row failure (blank required `name` in an added row) lands nested —
  // `errors[name]` is an array of per-row error objects instead — so without
  // this branch a half-filled row fails validation with NO visible message
  // and Generate silently no-ops. `name` is the only required cell per row.
  const rawError = errors[name] as
    | { message?: string }
    | ({ name?: { message?: string } } | undefined)[]
    | undefined
  const error = Array.isArray(rawError)
    ? rawError.find((row) => row?.name?.message)?.name?.message
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
                  <Input
                    {...register(`${name}.${idx}.nationality`)}
                    className="h-8 px-2"
                    aria-label={t('application.inmatesTable.nationality')}
                    dir="auto"
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
                    variant="ghost"
                    aria-label={t('application.inmatesTable.removeRow')}
                    onClick={() => remove(idx)}
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
