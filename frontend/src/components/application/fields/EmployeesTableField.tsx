/**
 * EmployeesTableField — multi-employee picker for the Passport Release list.
 *
 * Type a G-number + Add → resolves the employee via GET /employees/{id} and
 * appends a row auto-filled with ID, Name (Arabic, for the doc), Nationality,
 * Passport No. ＋ adds more; hard cap 15 (the template has 15 data rows). ID +
 * Name are read-only (identity); Nationality + Passport No are editable
 * (correctable when the record is blank). Output shape feeds the backend
 * item(i, field) render: [{ employee_id, name, nationality, passport_no }].
 */

import { useState } from 'react'
import { useFieldArray, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FieldProps } from '../types'

interface Row {
  employee_id: string
  name: string
  nationality?: string
  passport_no?: string
}

const MAX_ROWS = 15

export function EmployeesTableField({
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
    getValues,
    formState: { errors },
  } = useFormContext()
  const { fields, append, remove } = useFieldArray({ control, name })
  const error = (errors[name] as { message?: string } | undefined)?.message

  const [g, setG] = useState('')
  const [busy, setBusy] = useState(false)
  const [lookupErr, setLookupErr] = useState<string | null>(null)
  const atCap = fields.length >= MAX_ROWS

  async function add(): Promise<void> {
    const id = g.trim()
    if (!id || busy || atCap) return
    const existing = (getValues(name) as Row[] | undefined) ?? []
    if (existing.some((r) => (r.employee_id ?? '').toUpperCase() === id.toUpperCase())) {
      setLookupErr(t('application.employeesTable.duplicate', { defaultValue: 'Already added.' }))
      setG('') // already in the list — clear so the next entry starts fresh
      return
    }
    setBusy(true)
    setLookupErr(null)
    try {
      const emp = await api.getEmployee(id)
      append({
        employee_id: emp.id,
        name: emp.name_ar || emp.name_en || '',
        nationality: emp.nationality ?? '',
        passport_no: emp.passport_no ?? '',
      } satisfies Row)
      setG('')
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

      {/* Add-by-G-number row */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${name}__g`} className="text-xs text-muted-foreground">
            {t('application.employeesTable.gNumber', { defaultValue: 'G-number' })}
          </Label>
          <Input
            id={`${name}__g`}
            value={g}
            onChange={(e) => setG(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void add()
              }
            }}
            placeholder="G1234"
            className="h-9 w-40"
            disabled={atCap}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void add()}
          disabled={busy || atCap}
        >
          {fields.length === 0
            ? t('application.employeesTable.add', { defaultValue: 'Add' })
            : t('application.employeesTable.addAnother', { defaultValue: '+ Add another' })}
        </Button>
        <span className="text-xs text-muted-foreground">
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
              <tr className="border-b border-hairline text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground [&_th]:text-start">
                <th scope="col" className="w-24">
                  {t('application.employeesTable.id', { defaultValue: 'ID' })}
                </th>
                <th scope="col">
                  {t('application.employeesTable.name', { defaultValue: 'Name' })}
                </th>
                <th scope="col" className="w-32">
                  {t('application.employeesTable.nationality', { defaultValue: 'Nationality' })}
                </th>
                <th scope="col" className="w-36">
                  {t('application.employeesTable.passport', { defaultValue: 'Passport No' })}
                </th>
                <th scope="col" className="w-10" />
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
                    <td dir="auto">
                      <input type="hidden" {...register(`${name}.${idx}.name`)} />
                      {r.name}
                    </td>
                    <td>
                      <Input
                        {...register(`${name}.${idx}.nationality`)}
                        className="h-8 px-2"
                        dir="auto"
                      />
                    </td>
                    <td>
                      <Input {...register(`${name}.${idx}.passport_no`)} className="h-8 px-2" dir="auto" />
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => remove(idx)}
                        aria-label={t('common.delete', { defaultValue: 'Delete' })}
                        className="text-base leading-none text-destructive hover:underline"
                      >
                        ×
                      </button>
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
