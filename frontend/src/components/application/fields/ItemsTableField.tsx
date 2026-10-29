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
 * A store catalogue adds optional code suggestions without restricting free text
 * or adding catalogue identifiers to the legacy output.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import type { StorePickerItem } from '@/lib/api'
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
  itemCatalog?: TemplateField['item_catalog']
}

export function ItemsTableField({
  name,
  label_en,
  label_ar,
  required,
  columns,
  maxRows,
  itemCatalog,
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
                      {itemCatalog === 'store' ? (
                        <StoreItemCodeInput name={name} index={idx} />
                      ) : (
                        <Input {...register(`${name}.${idx}.code`)} className="h-8 px-2" />
                      )}
                    </td>
                    <td>
                      <Input {...register(`${name}.${idx}.description`)} dir="auto" className="h-8 px-2" />
                    </td>
                    <td>
                      <Input {...register(`${name}.${idx}.unit`)} dir="auto" className="h-8 px-2" />
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

function StoreItemCodeInput({ name, index }: { name: string; index: number }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const { register, control, setValue } = useFormContext()
  const codePath = `${name}.${index}.code`
  const code = useWatch({ control, name: codePath, defaultValue: '' }) as string
  const registration = register(codePath)
  const { data, isSuccess } = useQuery({
    queryKey: ['store-picker-items'],
    queryFn: api.listStorePickerItems,
    staleTime: 5 * 60 * 1000,
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const listId = useId()
  const query = (code ?? '').trim().toLocaleLowerCase()
  const items = (data ?? []).filter((item) =>
    [item.code, item.name_en, item.name_ar ?? ''].some((value) =>
      value.toLocaleLowerCase().includes(query),
    ),
  )
  const expanded = isSuccess && open
  const activeIndex = active >= 0 && active < items.length ? active : -1

  function choose(item: StorePickerItem) {
    const values = {
      code: item.code,
      description: isAr ? item.name_ar || item.name_en : item.name_en || item.name_ar || '',
      unit: isAr ? item.counting_unit_ar : item.counting_unit_en,
    }
    for (const [key, value] of Object.entries(values)) {
      setValue(`${name}.${index}.${key}`, value, { shouldDirty: true, shouldValidate: true })
    }
    setOpen(false)
    setActive(-1)
  }

  // Escape the table's horizontal scroller; keep logical positioning in RTL.
  useLayoutEffect(() => {
    if (!expanded) return
    const place = () => {
      const input = inputRef.current
      const panel = panelRef.current
      if (!input || !panel) return
      const rect = input.getBoundingClientRect()
      const width = Math.min(320, window.innerWidth - 16)
      const inlineStart = isAr ? window.innerWidth - rect.right : rect.left
      panel.style.insetInlineStart = `${Math.max(8, Math.min(inlineStart, window.innerWidth - width - 8))}px`
      panel.style.inlineSize = `${width}px`
      const below = window.innerHeight - rect.bottom - 8
      const above = rect.top - 8
      const useAbove = below < 160 && above > below
      panel.style.insetBlockStart = useAbove ? 'auto' : `${rect.bottom + 4}px`
      panel.style.insetBlockEnd = useAbove ? `${window.innerHeight - rect.top + 4}px` : 'auto'
      panel.style.maxBlockSize = `${Math.max(44, Math.min(256, (useAbove ? above : below) - 4))}px`
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [expanded, isAr])

  useEffect(() => {
    if (expanded && activeIndex >= 0) {
      document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
    }
  }, [expanded, activeIndex, listId])

  return (
    <>
      <Input
        {...registration}
        ref={(element) => {
          registration.ref(element)
          inputRef.current = element
        }}
        role={isSuccess ? 'combobox' : undefined}
        aria-label={isSuccess ? t('application.itemsTable.picker.label', { row: index + 1 }) : undefined}
        aria-expanded={isSuccess ? expanded : undefined}
        aria-controls={expanded ? listId : undefined}
        aria-autocomplete={isSuccess ? 'list' : undefined}
        aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        placeholder={isSuccess ? t('application.itemsTable.picker.placeholder') : undefined}
        autoComplete={isSuccess ? 'off' : undefined}
        dir={isSuccess ? 'ltr' : undefined}
        className={isSuccess ? 'min-h-11 px-2 font-mono tabular-nums' : 'h-8 px-2'}
        onFocus={() => {
          setOpen(true)
          setActive(-1)
        }}
        onBlur={(event) => {
          void registration.onBlur(event)
          setOpen(false)
          setActive(-1)
        }}
        onChange={(event) => {
          void registration.onChange(event)
          setOpen(true)
          setActive(-1)
        }}
        onKeyDown={(event) => {
          if (!isSuccess || event.nativeEvent.isComposing) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
            const direction = event.key === 'ArrowDown' ? 1 : -1
            setActive(items.length
              ? activeIndex < 0
                ? (direction === 1 ? 0 : items.length - 1)
                : (activeIndex + direction + items.length) % items.length
              : -1)
          } else if (expanded && (event.key === 'Home' || event.key === 'End')) {
            event.preventDefault()
            setActive(items.length ? (event.key === 'Home' ? 0 : items.length - 1) : -1)
          } else if (expanded && event.key === 'Enter' && activeIndex >= 0) {
            event.preventDefault()
            choose(items[activeIndex])
          } else if (expanded && event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
            setActive(-1)
          }
        }}
      />
      {expanded && createPortal(
        <div
          ref={panelRef}
          dir={isAr ? 'rtl' : 'ltr'}
          className="fixed z-[70] overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-md"
        >
          <div id={listId} role="listbox" aria-label={t('application.itemsTable.picker.options')}>
            {items.map((item, optionIndex) => (
              <button
                key={item.id}
                id={`${listId}-${optionIndex}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={optionIndex === activeIndex}
                className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-surface-tinted aria-selected:bg-primary-soft"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(item)}
              >
                <bdi dir="ltr" className="font-mono tabular-nums">{item.code}</bdi>
                <span dir="auto" className="min-w-0 flex-1 break-words">
                  {isAr ? item.name_ar || item.name_en : item.name_en || item.name_ar}
                </span>
                {optionIndex === activeIndex && <Check aria-hidden="true" className="size-4 shrink-0" />}
              </button>
            ))}
          </div>
          {items.length === 0 && (
            <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
              {t('application.itemsTable.picker.empty')}
            </p>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
