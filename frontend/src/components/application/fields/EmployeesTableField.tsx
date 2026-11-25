/**
 * EmployeesTableField — multi-employee picker for the release lists
 * (Passport, Work ID, UAE ID).
 *
 * Search + pick an employee → resolves via GET /employees/lookup/{id} and appends a
 * row: ID and Name (Arabic, for the doc) are read-only identity; the template's
 * `columns` follow as editable cells prefilled from the lookup (correctable
 * when the record is blank). Hard cap 15 (each template has 15 data rows).
 * Output shape feeds the backend item(i, field) render:
 * [{ employee_id, name, <column keys…> }].
 */

import { useState } from 'react'
import { useFieldArray, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import type { components } from '@/lib/api.types'
import { formatDmy } from '@/lib/formatDmy'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmployeePicker } from '@/pages/application/EmployeePicker'
import type { FieldProps, TemplateField } from '../types'

type EmployeeLookup = components['schemas']['EmployeeLookupRead']
type Column = NonNullable<TemplateField['columns']>[number]
type Row = { employee_id: string; name: string } & Record<string, string>

const MAX_ROWS = 15

/** Document numbers and dates read left-to-right in both languages. */
const LTR_KEYS: Record<string, true> = { passport_no: true, uae_id_no: true, uae_id_expiry: true }

/**
 * Narrowest a cell may get, sized to its longest real value plus the input's
 * padding: below this the table scrolls instead of clipping digits.
 */
const CELL_MIN_WIDTH: Record<string, string> = {
  passport_no: 'min-w-[calc(10ch_+_1.25rem)]',
  uae_id_no: 'min-w-[calc(18ch_+_1.25rem)]', // 784-1990-1234567-1
  uae_id_expiry: 'min-w-[calc(10ch_+_1.25rem)]', // dd/mm/yyyy
}
const TEXT_CELL_MIN_WIDTH = 'min-w-[8rem]'

/** Prefill for one template column from the lookup. Arabic first: the papers are Arabic. */
function prefillCell(emp: EmployeeLookup, key: string): string {
  switch (key) {
    case 'position':
      return emp.position_ar || emp.position || ''
    case 'uae_id_expiry':
      return emp.uae_id_expiry ? formatDmy(emp.uae_id_expiry) : ''
    default: {
      const value = (emp as unknown as Record<string, unknown>)[key]
      return typeof value === 'string' ? value : ''
    }
  }
}

export function EmployeesTableField({
  name,
  label_en,
  label_ar,
  required,
  columns = [],
}: FieldProps & { columns?: Column[] }): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const label = isAr ? label_ar : label_en

  const {
    control,
    register,
    getValues,
    formState: { errors },
  } = useFormContext()
  const { fields, append, remove } = useFieldArray({ control, name })
  const error = (errors[name] as { message?: string } | undefined)?.message

  const [busy, setBusy] = useState(false)
  const [lookupErr, setLookupErr] = useState<string | null>(null)
  const atCap = fields.length >= MAX_ROWS

  async function add(id: string | null): Promise<void> {
    const gid = (id ?? '').trim()
    if (!gid || busy || atCap) return
    const existing = (getValues(name) as Row[] | undefined) ?? []
    if (existing.some((r) => (r.employee_id ?? '').toUpperCase() === gid.toUpperCase())) {
      setLookupErr(t('application.employeesTable.duplicate', { defaultValue: 'Already added.' }))
      return
    }
    setBusy(true)
    setLookupErr(null)
    try {
      const emp = await api.getEmployeeLookup(gid)
      const row: Row = { employee_id: emp.id, name: emp.name_ar || emp.name_en || '' }
      for (const col of columns) row[col.key] = prefillCell(emp, col.key)
      append(row)
    } catch (e) {
      setLookupErr(
        e instanceof ApiError && e.code === 'EMPLOYEE_NOT_FOUND'
          ? t('application.employeesTable.notFound', {
              defaultValue: 'No employee with that G-number.',
            })
          : t('application.employeesTable.lookupError', { defaultValue: 'Lookup failed.' }),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="col-span-1 flex flex-col gap-2 sm:col-span-2">
      <Label>
        {label}
        {required && <span className="ms-0.5 text-destructive">*</span>}
      </Label>

      {/* Add-by-search row — same combobox as the rest of the app */}
      <div className="flex flex-col gap-1">
        {!atCap ? (
          <EmployeePicker selectedId={null} onSelect={(id) => void add(id)} />
        ) : (
          <p className="text-xs text-muted-foreground">
            {t('application.employeesTable.capReached', {
              defaultValue: 'Maximum of {{n}} employees reached.',
              n: MAX_ROWS,
            })}
          </p>
        )}
        <span className="text-xs tabular-nums text-muted-foreground">
          {t('application.employeesTable.cap', {
            defaultValue: '{{n}}/15',
            n: fields.length,
          })}
        </span>
      </div>
      {lookupErr && (
        <span role="alert" className="text-xs text-destructive">
          {lookupErr}
        </span>
      )}

      {/* Resolved rows */}
      {fields.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-hairline bg-surface-tinted">
          <table className="w-full border-collapse text-sm [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-2 [&_tbody_tr]:border-t [&_tbody_tr]:border-hairline">
            <thead>
              <tr className="border-b border-hairline text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground rtl:tracking-normal [&_th]:text-start">
                <th scope="col" className="w-24">
                  {t('application.employeesTable.id', { defaultValue: 'ID' })}
                </th>
                <th scope="col">
                  {t('application.employeesTable.name', { defaultValue: 'Name' })}
                </th>
                {columns.map((col) => (
                  <th key={col.key} scope="col" className="w-36">
                    {isAr ? col.label_ar : col.label_en}
                  </th>
                ))}
                <th scope="col" className="w-10">
                  <span className="sr-only">{t('common.delete', { defaultValue: 'Delete' })}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {fields.map((row, idx) => {
                const r = row as unknown as Row
                return (
                  <tr key={row.id}>
                    <td className="font-medium tabular-nums">
                      <input type="hidden" {...register(`${name}.${idx}.employee_id`)} />
                      {r.employee_id}
                    </td>
                    <td className="min-w-[9rem]">
                      <input type="hidden" {...register(`${name}.${idx}.name`)} />
                      {/* Isolated, but aligned to the page like its header. */}
                      <bdi>{r.name}</bdi>
                    </td>
                    {columns.map((col) => {
                      const ltr = LTR_KEYS[col.key] === true
                      return (
                        <td key={col.key}>
                          <Input
                            {...register(`${name}.${idx}.${col.key}`)}
                            aria-label={`${isAr ? col.label_ar : col.label_en} · ${r.employee_id}`}
                            className={`h-8 px-2 ${CELL_MIN_WIDTH[col.key] ?? TEXT_CELL_MIN_WIDTH}${ltr ? ' tabular-nums' : ''}`}
                            dir={ltr ? 'ltr' : 'auto'}
                          />
                        </td>
                      )
                    })}
                    <td>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => remove(idx)}
                        aria-label={`${t('common.delete', { defaultValue: 'Delete' })} ${r.employee_id}`}
                        className="text-destructive"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
