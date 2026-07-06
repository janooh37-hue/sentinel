/**
 * ClearanceTableField — fixed clearance grid for the Employee Clearance Form.
 *
 * Rows are hard-coded from the template layout: table 2 rows 2-22 (row 1 is the
 * "Documents" column header — no clearance cell) and table 3 rows 1-14
 * ("Laptop/Desktop" is 3_1). Each `${table}_${row}` key maps 1:1 to a
 * `clearance(t, r)` token in the DOCX, so this list MUST stay in lockstep with
 * the template. For each row the user picks Cleared / Not Cleared / Skip and
 * optionally writes a remark.
 *
 * Emits `{ clearance_marks: {"<tbl>_<row>": bool}, clearance_remarks: {"<tbl>_<row>": str} }`
 * under the `clearance_table` field key. The backend `_adapt_employee_clearance`
 * adapter lifts these to top-level so the Jinja `clearance()` helper finds them.
 *
 * "Skip" leaves a row out of the marks dict entirely (Jinja prints empty).
 */

import { Controller, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FieldProps } from '../types'

interface Row {
  table: 2 | 3
  row: number
  department: string
  item: string
}

const ROWS: ReadonlyArray<Row> = [
  // Table 2 — Operations + Supply Chain (row 1 "Documents" is a header, no cell)
  { table: 2, row: 2, department: 'Operations', item: 'Armed License' },
  { table: 2, row: 3, department: 'Operations', item: 'CICPA Card' },
  { table: 2, row: 4, department: 'Operations', item: 'ID Card' },
  { table: 2, row: 5, department: 'Operations', item: 'Tonfa' },
  { table: 2, row: 6, department: 'Operations', item: 'Radio' },
  { table: 2, row: 7, department: 'Operations', item: 'Keys' },
  { table: 2, row: 8, department: 'Operations', item: 'Weapon ID' },
  { table: 2, row: 9, department: 'Operations', item: 'Pistol/Rifle' },
  { table: 2, row: 10, department: 'Operations', item: 'Taser Gun' },
  { table: 2, row: 11, department: 'Operations', item: 'Handcuff' },
  { table: 2, row: 12, department: 'Operations', item: 'Pepper Spray' },
  { table: 2, row: 13, department: 'Operations', item: 'Ammunition' },
  { table: 2, row: 14, department: 'Operations', item: 'Access Cards' },
  { table: 2, row: 15, department: 'Operations', item: 'Electronic Devices' },
  { table: 2, row: 16, department: 'Operations', item: 'Others' },
  { table: 2, row: 17, department: 'Supply Chain', item: 'Access cards' },
  { table: 2, row: 18, department: 'Supply Chain', item: 'RIOT Equipment' },
  { table: 2, row: 19, department: 'Supply Chain', item: 'Traffic Fine' },
  { table: 2, row: 20, department: 'Supply Chain', item: 'Mobile' },
  { table: 2, row: 21, department: 'Supply Chain', item: 'SIM Card' },
  { table: 2, row: 22, department: 'Supply Chain', item: 'Others' },
  // Table 3 — IT / Finance / HR ("Laptop/Desktop" is now a real item, 3_1)
  { table: 3, row: 1, department: 'IT', item: 'Laptop/Desktop' },
  { table: 3, row: 2, department: 'IT', item: 'PC Backup' },
  { table: 3, row: 3, department: 'IT', item: 'Email' },
  { table: 3, row: 4, department: 'IT', item: 'DMS' },
  { table: 3, row: 5, department: 'IT', item: 'Bio-Metric Access' },
  { table: 3, row: 6, department: 'IT', item: 'ERP' },
  { table: 3, row: 7, department: 'IT', item: 'Share Folder' },
  { table: 3, row: 8, department: 'IT', item: 'Others' },
  { table: 3, row: 9, department: 'Finance', item: 'Payment / Deduction' },
  { table: 3, row: 10, department: 'Finance', item: 'Others' },
  { table: 3, row: 11, department: 'HR', item: 'Passport' },
  { table: 3, row: 12, department: 'HR', item: 'Medical Insurance Card' },
  { table: 3, row: 13, department: 'HR', item: 'ID Card' },
  { table: 3, row: 14, department: 'HR', item: 'Others' },
]

const key = (r: Row): string => `${r.table}_${r.row}`

// Slugify a hard-coded English label into a stable i18n key segment.
const slug = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

interface Value {
  clearance_marks: Record<string, boolean>
  clearance_remarks: Record<string, string>
}

const EMPTY: Value = { clearance_marks: {}, clearance_remarks: {} }

export function ClearanceTableField({
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
        defaultValue={EMPTY}
        render={({ field }) => {
          const value = (field.value as Value | undefined) ?? EMPTY

          const setMark = (k: string, mark: boolean | undefined) => {
            const next = { ...value.clearance_marks }
            if (mark === undefined) delete next[k]
            else next[k] = mark
            field.onChange({ ...value, clearance_marks: next })
          }

          const setRemark = (k: string, remark: string) => {
            const next = { ...value.clearance_remarks }
            if (!remark) delete next[k]
            else next[k] = remark
            field.onChange({ ...value, clearance_remarks: next })
          }

          const setAll = (mark: boolean): void => {
            const next: Record<string, boolean> = {}
            for (const r of ROWS) next[key(r)] = mark
            field.onChange({ ...value, clearance_marks: next })
          }

          return (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => setAll(true)}>
                  {t('application.clearance.allYes', { defaultValue: 'All Cleared' })}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setAll(false)}>
                  {t('application.clearance.allNo', { defaultValue: 'All Not' })}
                </Button>
              </div>
              <div className="overflow-x-auto rounded-md border border-hairline bg-surface-tinted">
                <table className="w-full border-collapse text-sm [&_td]:px-3 [&_td]:py-1.5 [&_th]:px-3 [&_th]:py-2 [&_tbody_tr]:border-t [&_tbody_tr]:border-hairline">
                  <thead>
                    <tr className="border-b border-hairline text-start text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground [&_th]:text-start">
                      <th scope="col">{t('application.clearance.department', { defaultValue: 'Department' })}</th>
                      <th scope="col">{t('application.clearance.item', { defaultValue: 'Item' })}</th>
                      <th scope="col" className="w-32">{t('application.clearance.status', { defaultValue: 'Status' })}</th>
                      <th scope="col">{t('application.clearance.remarks', { defaultValue: 'Remarks' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((r) => {
                      const k = key(r)
                      const mark = value.clearance_marks[k]
                      const remark = value.clearance_remarks[k] ?? ''
                      return (
                        <tr key={k}>
                          <td className="text-xs text-muted-foreground">
                            {t(`application.clearance.departments.${slug(r.department)}`, {
                              defaultValue: r.department,
                            })}
                          </td>
                          <td className="text-foreground">
                            {t(`application.clearance.items.${slug(r.item)}`, {
                              defaultValue: r.item,
                            })}
                          </td>
                          <td>
                            <div className="flex items-center gap-3 text-xs">
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`${name}-${k}`}
                                  checked={mark === true}
                                  onChange={() => setMark(k, true)}
                                  className="h-3.5 w-3.5 shrink-0 accent-primary"
                                />
                                {t('application.clearance.yes', { defaultValue: 'Cleared' })}
                              </label>
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`${name}-${k}`}
                                  checked={mark === false}
                                  onChange={() => setMark(k, false)}
                                  className="h-3.5 w-3.5 shrink-0 accent-primary"
                                />
                                {t('application.clearance.no', { defaultValue: 'Not' })}
                              </label>
                            </div>
                          </td>
                          <td>
                            <Input
                              value={remark}
                              onChange={(e) => setRemark(k, e.target.value)}
                              className="h-8 px-2"
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
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
