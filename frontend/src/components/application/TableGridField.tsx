/**
 * TableGridField — add-row-only RTL data grid for General Book table templates.
 *
 * Props:
 *   name    — react-hook-form field path (e.g. "table_rows")
 *   columns — Arabic header texts from the template schema
 *
 * Form value: Record<string,string>[] keyed c0..c{N-1} by logical column index.
 * Column c0 renders rightmost because the wrapper carries dir="rtl".
 */

import { useFieldArray, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
  name: string
  columns: string[]
}

export function TableGridField({ name, columns }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { control, register } = useFormContext()
  const { fields, append } = useFieldArray({ control, name })

  const blankRow = (): Record<string, string> =>
    Object.fromEntries(columns.map((_, i) => [`c${i}`, '']))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Button type="button" size="xs" variant="secondary" onClick={() => append(blankRow())}>
          {t('application.itemsTable.addRow', { defaultValue: '+ Add row' })}
        </Button>
      </div>
      <div
        dir="rtl"
        className="overflow-x-auto rounded-md border border-hairline bg-surface-tinted"
      >
        <table className="w-full border-collapse text-sm [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-2 [&_tbody_tr]:border-t [&_tbody_tr]:border-hairline">
          <thead>
            <tr className="border-b border-hairline text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground [&_th]:text-start">
              {columns.map((col, i) => (
                <th key={i} scope="col">
                  {col || t('books.word.tableGrid.columnLabel', { n: i + 1, defaultValue: `Column ${i + 1}` })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length || 1}
                  className="py-4 text-center text-muted-foreground"
                >
                  {t('books.word.tableGrid.empty', {
                    defaultValue: 'No rows yet — add a row to begin.',
                  })}
                </td>
              </tr>
            )}
            {fields.map((row, rowIdx) => (
              <tr key={row.id}>
                {columns.map((_, colIdx) => (
                  <td key={colIdx}>
                    <Input
                      {...register(`${name}.${rowIdx}.c${colIdx}`)}
                      className="h-8 px-2"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
