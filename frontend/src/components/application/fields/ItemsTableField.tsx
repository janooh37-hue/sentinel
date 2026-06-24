/**
 * ItemsTableField — editable items table for Material Request + Acknowledgment.
 *
 * Backend `item(i, field)` helper looks up `data["items"][i][field]`. Material
 * Request templates read `sno/code/description/unit/qty/remarks`; Acknowledgment
 * reads `sno/description/unit/quantity`. We emit both `qty` and `quantity` so
 * either template renders correctly.
 *
 * Output shape: `[{sno, code, description, unit, qty, quantity, remarks}]`.
 */

import { useFieldArray, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FieldProps } from '../types'

interface Row {
  sno?: string
  code?: string
  description?: string
  unit?: string
  qty?: string
  quantity?: string
  remarks?: string
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

export function ItemsTableField({
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
    getValues,
    formState: { errors },
  } = useFormContext()

  const { fields, append, remove } = useFieldArray({ control, name })
  const error = (errors[name] as { message?: string } | undefined)?.message

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
              <th scope="col" className="w-28">{t('application.itemsTable.code', { defaultValue: 'Code' })}</th>
              <th scope="col">{t('application.itemsTable.description', { defaultValue: 'Description' })}</th>
              <th scope="col" className="w-24">{t('application.itemsTable.unit', { defaultValue: 'Unit' })}</th>
              <th scope="col" className="w-20">{t('application.itemsTable.qty', { defaultValue: 'Qty' })}</th>
              <th scope="col">{t('application.itemsTable.remarks', { defaultValue: 'Remarks' })}</th>
              <th scope="col" className="w-10" />
            </tr>
          </thead>
          <tbody>
            {fields.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-muted-foreground">
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
