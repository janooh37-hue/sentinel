/**
 * ItemsTableField — editable items table for Material Request + Acknowledgment,
 * and any template that supplies a `columns` config (a configurable grid).
 *
 * Backend `item(i, field)` helper looks up `data["items"][i][field]`. Material
 * Request templates read `sno/code/description/unit/qty/remarks`; Acknowledgment
 * reads `sno/description/unit/quantity`. We emit both `qty` and `quantity` so
 * either template renders correctly. That fixed shape is the DEFAULT when the
 * field carries no `columns` config.
 *
 * When `columns` is present (see `TemplateField.columns`), the table renders
 * exactly those bilingual columns instead — the DOCX's fixed-capacity table
 * rows must match `columns` 1:1 by key, and `maxRows` caps how many rows the
 * operator can add (matching the DOCX's fixed row count).
 *
 * Output shape (legacy): `[{sno, code, description, unit, qty, quantity, remarks}]`.
 * Output shape (configured): `[{sno, <column.key>: string, …}]`.
 */

import { useFieldArray, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FieldProps, TemplateField } from '../types'

interface Row {
  sno?: string
  code?: string
  description?: string
  unit?: string
  qty?: string
  quantity?: string
  remarks?: string
  [key: string]: string | undefined
}

const blankRow = (n: number): Row => ({
  sno: String(n),
  code: '',
  description: '',
  unit: '',
  qty: '',
  quantity: '',
  remarks: '',
})

interface ItemsTableFieldProps extends FieldProps {
  columns?: TemplateField['columns']
  maxRows?: number
}

export function ItemsTableField({
  name,
  label_en,
  label_ar,
  required,
  columns,
  maxRows,
}: ItemsTableFieldProps): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const label = isAr ? label_ar : label_en

  const {
    control,
    register,
    setValue,
    getValues,
    formState: { errors },
  } = useFormContext()

  const { fields, append, remove } = useFieldArray({ control, name })
  const error = (errors[name] as { message?: string } | undefined)?.message
  const atCap = typeof maxRows === 'number' && fields.length >= maxRows

  const onQtyChange = (idx: number, val: string) => {
    setValue(`${name}.${idx}.qty`, val, { shouldDirty: true })
    setValue(`${name}.${idx}.quantity`, val, { shouldDirty: true })
  }

  return (
    <div className="col-span-1 sm:col-span-2 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>
          {label}
          {required && <span className="ms-0.5 text-destructive">*</span>}
        </Label>
        <Button
          type="button"
          size="xs"
          variant="secondary"
          disabled={atCap}
          onClick={() => append(blankRow(fields.length + 1))}
        >
          {t('application.itemsTable.addRow', { defaultValue: '+ Add row' })}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-hairline bg-surface-tinted">
        <table className="w-full border-collapse text-sm [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-2 [&_tbody_tr]:border-t [&_tbody_tr]:border-hairline">
          <thead>
            <tr className="border-b border-hairline text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground [&_th]:text-start">
              <th scope="col" className="w-12">#</th>
              {columns ? (
                columns.map((col) => (
                  <th scope="col" key={col.key}>
                    {isAr ? col.label_ar : col.label_en}
                  </th>
                ))
              ) : (
                <>
                  <th scope="col" className="w-28">{t('application.itemsTable.code', { defaultValue: 'Code' })}</th>
                  <th scope="col">{t('application.itemsTable.description', { defaultValue: 'Description' })}</th>
                  <th scope="col" className="w-24">{t('application.itemsTable.unit', { defaultValue: 'Unit' })}</th>
                  <th scope="col" className="w-20">{t('application.itemsTable.qty', { defaultValue: 'Qty' })}</th>
                  <th scope="col">{t('application.itemsTable.remarks', { defaultValue: 'Remarks' })}</th>
                </>
              )}
              <th scope="col" className="w-10" />
            </tr>
          </thead>
          <tbody>
            {fields.length === 0 && (
              <tr>
                <td colSpan={(columns?.length ?? 5) + 2} className="py-4 text-center text-muted-foreground">
                  {t('application.itemsTable.empty', { defaultValue: 'No items — add a row to begin.' })}
                </td>
              </tr>
            )}
            {fields.map((row, idx) => (
              <tr key={row.id}>
                <td>
                  <Input
                    {...register(`${name}.${idx}.sno`)}
                    defaultValue={String(idx + 1)}
                    className="h-8 px-2"
                  />
                </td>
                {columns ? (
                  columns.map((col) => (
                    <td key={col.key}>
                      <Input {...register(`${name}.${idx}.${col.key}`)} className="h-8 px-2" />
                    </td>
                  ))
                ) : (
                  <>
                    <td>
                      <Input {...register(`${name}.${idx}.code`)} className="h-8 px-2" />
                    </td>
                    <td>
                      <Input {...register(`${name}.${idx}.description`)} className="h-8 px-2" />
                    </td>
                    <td>
                      <Input {...register(`${name}.${idx}.unit`)} className="h-8 px-2" />
                    </td>
                    <td>
                      <Input
                        type="text"
                        inputMode="numeric"
                        defaultValue={
                          (getValues(`${name}.${idx}.qty`) as string | undefined) ??
                          (getValues(`${name}.${idx}.quantity`) as string | undefined) ??
                          ''
                        }
                        onChange={(e) => onQtyChange(idx, e.target.value)}
                        className="h-8 px-2"
                      />
                    </td>
                    <td>
                      <Input {...register(`${name}.${idx}.remarks`)} className="h-8 px-2" />
                    </td>
                  </>
                )}
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
