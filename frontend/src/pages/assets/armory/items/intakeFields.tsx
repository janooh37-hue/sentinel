import { Plus, ScanLine, X } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState, type ComponentPropsWithRef } from 'react'

import { Field } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { ArmoryItemCreate } from '@/lib/api'
import { cn } from '@/lib/utils'

import { Ltr } from '../ArmoryLtr'
import { useArmoryLocale } from '../armoryFormat'
import { blankBatch, KIND_DEFAULTS, type BatchDraft, type IntakeEntryDraft, type IntakeInspection } from './intakeEntry'

/** The approved text templates are plain i18next strings. Insert isolated values without assuming their order. */
export function IntakeText({ message, values }: { message: string; values: Record<string, string | number> }) {
  const { t } = useArmoryLocale()
  const parts = Object.entries(values)
  const replacements = Object.fromEntries(parts.map(([key], index) => [key, `\uE000${index}\uE001`]))
  const count = typeof values.count === 'number' ? values.count : undefined
  const text = t(`assets.armory.${message}`, { count, replace: replacements })
  return <>{text.split(/\uE000(\d+)\uE001/).map((part, index) => {
    if (index % 2 === 0) return part
    const [key, value] = parts[Number(part)]
    return key === 'item' ? <bdi key={index}>{value}</bdi> : <Ltr key={index} className="tabular-nums">{value}</Ltr>
  })}</>
}

type SelectProps = ComponentPropsWithRef<'select'> & { label: string; hint?: string }
export function IntakeSelect({ label, hint, className, children, ...props }: SelectProps) {
  const id = useId()
  return <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
    <label className="text-sm font-medium" htmlFor={id}>{label}</label>
    <select {...props} id={id} aria-describedby={hint ? `${id}-hint` : props['aria-describedby']}
      className="min-h-11 w-full min-w-0 rounded-md border border-input bg-surface px-3 text-sm text-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background">
      {children}
    </select>
    {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
  </div>
}

export function IntakeDateField({ opening, value, today, onChange }: {
  opening: boolean; value: string; today: string; onChange(value: string): void
}) {
  const { t } = useArmoryLocale()
  const id = useId()
  return <Field id={id} label={t(opening ? 'assets.armory.openingDate' : 'assets.armory.stockDate')} required>
    <Input id={id} type="date" dir="ltr" min="0001-01-01" max={today} className="min-h-11 min-w-0" required
      value={value} onChange={event => onChange(event.target.value)} />
  </Field>
}

export function IntakeReferenceField({ value, required, onChange }: {
  value: string; required: boolean; onChange(value: string): void
}) {
  const { t } = useArmoryLocale()
  const id = useId()
  return <Field id={id} label={t('assets.armory.reference')} required={required}>
    <Input id={id} dir="ltr" maxLength={80} className="min-h-11" required={required} value={value}
      onChange={event => onChange(event.target.value)} />
  </Field>
}

function QuantityField({ label, value, invalid, onChange }: {
  label: string; value: string; invalid?: boolean; onChange(value: string): void
}) {
  const id = useId()
  return <Field id={id} label={label}>
    <Input id={id} dir="ltr" inputMode="numeric" autoComplete="off" className="min-h-11 tabular-nums" aria-invalid={invalid || undefined}
      value={value} onChange={event => onChange(event.target.value)} />
  </Field>
}

function SerialPad({ value, serials, onChange }: {
  value: string; serials: IntakeInspection['serials']; onChange(value: string): void
}) {
  const { t } = useArmoryLocale()
  const id = useId()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const valid = serials.filter(serial => serial.valid && !serial.duplicate)
  const errors = serials.filter(serial => !serial.valid || serial.duplicate)
  const reviewItem = ({ code, valid, duplicate }: IntakeInspection['serials'][number], index: number) => (
    <li key={index} className={cn('flex max-w-full flex-wrap gap-x-1.5 rounded border px-1.5 py-0.5 text-xs [overflow-wrap:anywhere]',
      valid && !duplicate ? 'bg-surface' : 'bg-accent-soft text-destructive-text')}>
      <Ltr className="font-mono">{code}</Ltr>
      {!valid ? t('assets.armory.invalidStockCode') : duplicate ? t('assets.armory.serialRepeated') : null}
    </li>
  )
  function startScan() {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.setSelectionRange(value.length, value.length)
    if (value && value.length < 16_000 && !/\s$/.test(value)) onChange(`${value}\n`)
  }
  return <div className="min-w-0 space-y-1.5">
    <div className="flex flex-wrap items-center justify-between gap-x-2">
      <label htmlFor={id} className="text-sm font-medium">{t('assets.armory.serialEntryLabel')}</label>
      <Button type="button" variant="ghost" className="min-h-11" onClick={startScan}>
        <ScanLine aria-hidden className="size-4" />{t('assets.armory.scanSerials')}
      </Button>
    </div>
    <Textarea ref={inputRef} id={id} dir="ltr" rows={2} maxLength={16_000} spellCheck={false} autoCapitalize="characters"
      className="min-h-14 resize-y font-mono" value={value} onChange={event => onChange(event.target.value)}
      placeholder={t('assets.armory.serialEntryPlaceholder')} aria-invalid={errors.length > 0 || undefined}
      aria-describedby={`${id}-hint ${id}-review`} />
    <p id={`${id}-hint`} className="text-xs text-muted-foreground">{t('assets.armory.serialPadHint')}</p>
    <div id={`${id}-review`} className="space-y-1.5">
      <p role="status" className="text-xs text-muted-foreground">{serials.length > 0 && <>
        <IntakeText message="serialReadyN" values={{ count: valid.length }} />
        {errors.length > 0 && <>{' · '}<IntakeText message="serialFixN" values={{ count: errors.length }} /></>}
      </>}</p>
      {serials.length > 0 && <ul className="flex flex-wrap gap-1.5">{[...errors, ...valid.slice(0, 10)].map(reviewItem)}</ul>}
      {valid.length > 10 && <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm text-primary-text">
          <IntakeText message="moreSerials" values={{ count: valid.length - 10 }} />
        </summary>
        <ul className="flex flex-wrap gap-1.5">{valid.slice(10).map(reviewItem)}</ul>
      </details>}
    </div>
  </div>
}

function BatchFields({ draft, opening, onChange }: {
  draft: IntakeEntryDraft; opening: boolean; onChange(value: IntakeEntryDraft): void
}) {
  const { t } = useArmoryLocale()
  const id = useId()
  const addRef = useRef<HTMLButtonElement>(null)
  const [focusKey, setFocusKey] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (focusKey !== null) document.getElementById(`${id}-${focusKey}-ref`)?.focus()
  }, [id, focusKey])

  function patchBatch(key: number, patch: Partial<BatchDraft>) {
    onChange({ ...draft, batches: draft.batches.map(row => row.key === key ? { ...row, ...patch } : row) })
  }

  return <div className="space-y-2">
    {draft.batches.map(row => {
      const prefix = `${id}-${row.key}`
      return <div key={row.key} className="grid min-w-0 grid-cols-2 items-end gap-2 border-b border-hairline pb-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.75fr)_auto]">
        <Field id={`${prefix}-ref`} label={t('assets.armory.batchNumber')}>
          <Input id={`${prefix}-ref`} dir="ltr" className="min-h-11 font-mono" maxLength={80} autoCapitalize="characters"
            spellCheck={false} value={row.reference} onChange={event => patchBatch(row.key, { reference: event.target.value })} />
        </Field>
        <Field id={`${prefix}-expiry`} label={t('assets.armory.batchExpiry')}>
          <Input id={`${prefix}-expiry`} dir="ltr" className="min-h-11 tabular-nums" autoComplete="off"
            aria-describedby={`${id}-expiry-hint`} value={row.expiry} onChange={event => patchBatch(row.key, { expiry: event.target.value })} />
        </Field>
        <QuantityField label={t('assets.armory.quantity')} value={row.quantity} onChange={quantity => patchBatch(row.key, { quantity })} />
        <Button type="button" size="icon" variant="ghost" className="min-h-11 min-w-11 justify-self-end" aria-label={t('assets.armory.removeBatch')}
          onClick={() => { onChange({ ...draft, batches: draft.batches.filter(batch => batch.key !== row.key) }); setFocusKey(null); addRef.current?.focus() }}>
          <X aria-hidden className="size-4" />
        </Button>
      </div>
    })}
    {draft.batches.length > 0 && <p id={`${id}-expiry-hint`} className="text-xs text-muted-foreground">
      <IntakeText message="expiryFormat" values={{ date: '31/12/2027', month: '12/2027' }} />
    </p>}
    <div className="flex flex-wrap items-center gap-2">
      <Button ref={addRef} type="button" variant="secondary" className="min-h-11" onClick={() => {
        const key = (draft.batches.at(-1)?.key ?? -1) + 1
        onChange({ ...draft, batches: [...draft.batches, blankBatch(key)] })
        setFocusKey(key)
      }}><Plus aria-hidden className="size-4" />{t('assets.armory.addBatch')}</Button>
      {opening && <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={draft.countedZero}
          onChange={event => onChange({ ...draft, countedZero: event.target.checked })} />
        {t('assets.armory.countedZero')}
      </label>}
    </div>
  </div>
}

export function IntakeEntryFields({ kind, opening, draft, inspection, onChange }: {
  kind: ArmoryItemCreate['kind']; opening: boolean; draft: IntakeEntryDraft; inspection: IntakeInspection; onChange(value: IntakeEntryDraft): void
}) {
  const { t } = useArmoryLocale()
  const type = KIND_DEFAULTS[kind].entry
  if (type === 'quantity') return <QuantityField label={t('assets.armory.quantity')} value={draft.quantity}
    invalid={!!inspection.error} onChange={quantity => onChange({ ...draft, quantity })} />
  if (type === 'expiry') return <BatchFields draft={draft} opening={opening} onChange={onChange} />
  return <div className="space-y-2">
    <SerialPad value={draft.serialText} serials={inspection.serials} onChange={serialText => onChange({ ...draft, serialText })} />
    {opening && <details open={draft.unrecordedQty ? true : undefined}>
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-primary-text">{t('assets.armory.serialsLater')}</summary>
      <QuantityField label={t('assets.armory.unrecordedQty')} value={draft.unrecordedQty}
        invalid={inspection.error === 'needStockQuantity'} onChange={unrecordedQty => onChange({ ...draft, unrecordedQty })} />
    </details>}
  </div>
}
