import { useId, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Minus, Plus } from 'lucide-react'
import { z } from 'zod'

import { DialogBody, DialogFooter, DialogShell, FormAlert } from '@/components/forms/DialogShell'
import { UniformArt } from '@/components/UniformArt'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type UniformHolding, type UniformItemRead, type UniformReturnLine, type UniformReturnRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { pickEmployeeName } from '@/lib/employeeName'
import { formatDmy } from '@/lib/formatDmy'
import { todayIso } from '@/lib/leaveDateMath'
import { toast } from '@/lib/toast'
import { useCapabilities } from '@/lib/useCapabilities'
import { EmployeeSearch, type UniformEmployee } from '../EmployeeSearch'
import { whole } from '../quantity'
import { uniformErrorMessage, useCreateUniformReturn, useUniformEmployee, useUniformItems } from '../uniformQueries'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Preselects the person, as the Received panel does. */
  employee?: UniformEmployee
  returnFocusRef?: React.RefObject<HTMLElement | null>
  onSuccess?: (record: UniformReturnRead) => void
}

const schema = z.object({
  employeeId: z.string().min(1),
  rows: z.record(z.string(), z.object({ qty: z.string(), condition: z.enum(['reusable', 'damaged']), editLimit: z.number().nonnegative().optional() })),
})
type Values = z.infer<typeof schema>
type RowSnapshot = { holding: UniformHolding; item?: UniformItemRead; rawSize?: string }

export function ReturnDialog(props: Props): React.JSX.Element | null {
  const editable = useCapabilities().has('uniform.edit')
  return editable && props.open ? <ReturnContent {...props} /> : null
}

function ReturnContent({ open, onOpenChange, employee: initialEmployee, returnFocusRef, onSuccess }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const id = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const items = useUniformItems(true)
  const mutation = useCreateUniformReturn()
  const [employee, setEmployee] = useState<UniformEmployee | null>(initialEmployee ?? null)
  const [snapshots, setSnapshots] = useState<Record<string, RowSnapshot>>({})
  const holdings = useUniformEmployee(employee?.id ?? '')
  const { control, setValue, getValues, reset, handleSubmit } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { employeeId: initialEmployee?.id ?? '', rows: {} },
  })
  const drafts = useWatch({ control, name: 'rows' })
  const currentHoldings = new Map((holdings.data?.holdings ?? []).map(holding => [`${holding.item_id}:${holding.size_id ?? ''}`, holding]))
  const visibleHoldings = new Map([...currentHoldings].filter(([, holding]) => holding.qty > 0))
  for (const [key, snapshot] of Object.entries(snapshots)) {
    if (!visibleHoldings.has(key)) visibleHoldings.set(key, currentHoldings.get(key) ?? { ...snapshot.holding, qty: 0 })
  }
  const rows = [...visibleHoldings].map(([key, holding]) => {
    const draft = drafts[key]
    const currentItem = items.data?.find(item => item.id === holding.item_id)
    const item = currentItem ?? snapshots[key]?.item
    const currentSize = currentItem?.sizes.find(size => size.id === holding.size_id)
    const rawSize = currentSize?.label ?? snapshots[key]?.rawSize
    const unavailable = !currentItem || !!currentItem.archived_at
      || (holding.size_id == null ? currentItem.tracking !== 'holder' : currentItem.tracking !== 'shelf' || !currentSize || !!currentSize.archived_at)
    const condition: UniformReturnLine['condition'] = draft?.condition ?? 'reusable'
    return { key, holding, item, rawSize, unavailable, qty: whole(draft?.qty ?? '0'), condition }
  })
  const name = (item?: UniformItemRead) => item ? i18n.language.startsWith('ar') ? item.name_ar : item.name_en : ''
  function remember(row: typeof rows[number]) {
    setSnapshots(previous => ({ ...previous, [row.key]: { holding: row.holding, item: row.item, rawSize: row.rawSize } }))
  }
  const total = rows.reduce((sum, row) => sum + row.qty, 0)
  const initialError = (holdings.data === undefined && holdings.isError) || (items.data === undefined && items.isError)
  const loading = !!employee && (holdings.data === undefined || items.data === undefined)
  const itemsRefreshFailed = items.data !== undefined && items.isError
  const holdingsRefreshFailed = !!employee && holdings.data !== undefined && holdings.isError
  const selectionChanged = rows.some(row => row.qty > 0 && (row.unavailable || row.qty > row.holding.qty))
  const reason = !employee ? t('assets.uniform.needReturnEmployee') : initialError ? t('assets.uniform.error') : loading ? t('assets.uniform.loading') : selectionChanged ? t('assets.uniform.selectionChanged') : !total ? t('assets.uniform.needReturnQty') : ''
  const receiver = user ? pickEmployeeName({ name_en: user.name_en || user.email, name_ar: user.name_ar }, i18n.language) : ''
  function choose(next: UniformEmployee | null) {
    setEmployee(next)
    setSnapshots({})
    reset({ employeeId: next?.id ?? '', rows: {} })
  }
  return <DialogShell open={open} onOpenChange={onOpenChange} title={t('assets.uniform.returnTitle')} description={t('assets.uniform.conditionHint')} size="xl" busy={mutation.isPending} returnFocusRef={returnFocusRef}
    onOpenAutoFocus={event => { if (!initialEmployee && searchRef.current) { event.preventDefault(); searchRef.current.focus() } }}>
    <form noValidate aria-busy={mutation.isPending} className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit(() => {
      if (reason || mutation.isPending || !employee) return
      const lines: UniformReturnLine[] = rows.filter(row => row.qty > 0).map(row => ({ item_id: row.holding.item_id, ...(row.holding.size_id == null ? {} : { size_id: row.holding.size_id }), qty: row.qty, condition: row.condition }))
      mutation.mutate({ employee_id: employee.id, returned_on: todayIso(), lines }, {
        onSuccess: record => {
          toast.success(t('assets.uniform.returnSaved', { count: total }))
          onSuccess?.(record)
          onOpenChange(false)
        },
      })
    })}>
      <DialogBody>
        <FormAlert id={`${id}-items-refresh-error`} message={itemsRefreshFailed ? t('assets.uniform.refreshError') : null} />
        {itemsRefreshFailed && <Button type="button" variant="ghost" className="min-h-11 self-start" disabled={mutation.isPending} onClick={() => void items.refetch()}>{t('assets.uniform.retry')}</Button>}
        <FormAlert id={`${id}-holdings-refresh-error`} message={holdingsRefreshFailed ? t('assets.uniform.refreshRecordsError') : null} />
        {holdingsRefreshFailed && <Button type="button" variant="ghost" className="min-h-11 self-start" disabled={mutation.isPending} onClick={() => void holdings.refetch()}>{t('assets.uniform.retry')}</Button>}
        <FormAlert id={`${id}-error`} message={mutation.error ? uniformErrorMessage(mutation.error) : null} />
        <EmployeeSearch recipientsOnly value={employee} inputRef={searchRef} disabled={mutation.isPending} onChange={choose} />
        <section aria-labelledby={`${id}-held`}>
          <h3 id={`${id}-held`} className="mb-2 mt-2 text-sm font-semibold">{t('assets.uniform.currentlyHolds')}</h3>
          {!employee ? <p className="text-sm text-muted-foreground">{t('assets.uniform.needReturnEmployee')}</p>
            : initialError ? <div><p role="alert" className="text-sm text-destructive-text">{t('assets.uniform.error')}</p><Button type="button" variant="ghost" className="min-h-11" onClick={() => { void holdings.refetch(); void items.refetch() }}>{t('assets.uniform.retry')}</Button></div>
            : loading ? <p role="status" className="text-sm text-muted-foreground">{t('assets.uniform.loading')}</p>
            : rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('assets.uniform.holdsNone')}</p>
            : rows.map(row => {
              const item = row.item
              const held = row.holding.qty
              const maximum = row.unavailable ? 0 : held
              const size = row.rawSize ? row.rawSize === 'one' ? t('assets.uniform.oneSize') : <bdi dir="ltr">{row.rawSize}</bdi> : null
              const label = !row.rawSize ? name(item) : `${name(item)} ${row.rawSize === 'one' ? t('assets.uniform.oneSize') : row.rawSize}`
              const conflict = row.qty > 0 ? row.unavailable ? t('assets.uniform.lineUnavailable') : row.qty > held ? t('assets.uniform.heldAvailable', { count: held }) : '' : ''
              return <fieldset key={row.key} disabled={mutation.isPending} aria-labelledby={`${id}-line-${row.key}`} className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t border-hairline py-3 sm:grid-cols-[44px_minmax(0,1fr)_auto_auto]">
                {item ? <UniformArt kind={item.drawing} size={44} className="shrink-0" /> : <span />}
                <div className="min-w-0"><span id={`${id}-line-${row.key}`} dir="auto" className="block text-sm font-semibold">{name(item)}</span>
                  <span className="block text-xs text-muted-foreground">{size && <>{size} · </>}{t('assets.uniform.holdsN', { count: held })}</span>
                  {conflict && <p id={`${id}-conflict-${row.key}`} className="text-xs text-destructive-text">{conflict}</p>}</div>
                <div className="col-start-2 flex items-center justify-self-start rounded-md border border-border sm:col-start-auto">
                  <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" disabled={mutation.isPending || row.qty <= 0} aria-label={t('assets.uniform.dec', { name: label })} onClick={() => { remember(row); setValue(`rows.${row.key}.editLimit`, undefined); setValue(`rows.${row.key}.qty`, String(Math.min(maximum, Math.max(0, row.qty - 1)))) }}><Minus aria-hidden className="h-4 w-4" /></Button>
                  <Controller control={control} name={`rows.${row.key}.qty`} defaultValue="0" render={({ field }) => <Input {...field} type="number" min={0} max={held} step={1} inputMode="numeric" dir="ltr" aria-label={t('assets.uniform.qtyOf', { name: label })} aria-invalid={!!conflict} aria-describedby={conflict ? `${id}-conflict-${row.key}` : undefined}
                    className="min-h-11 w-16 border-0 px-1 text-center tabular-nums shadow-none"
                    onChange={event => { remember(row); setValue(`rows.${row.key}.editLimit`, maximum); field.onChange(event) }}
                    onBlur={() => {
                      field.onBlur()
                      const limit = getValues(`rows.${row.key}.editLimit`)
                      if (limit !== undefined) {
                        setValue(`rows.${row.key}.editLimit`, undefined)
                        field.onChange(String(Math.min(limit, whole(field.value))))
                      }
                    }}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} />} />
                  <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" disabled={mutation.isPending || row.qty >= maximum} aria-label={t('assets.uniform.inc', { name: label })} onClick={() => { remember(row); setValue(`rows.${row.key}.editLimit`, undefined); setValue(`rows.${row.key}.qty`, String(Math.min(maximum, row.qty + 1))) }}><Plus aria-hidden className="h-4 w-4" /></Button>
                </div>
                <Controller control={control} name={`rows.${row.key}.condition`} defaultValue="reusable" render={({ field }) => <div role="radiogroup" aria-label={t('assets.uniform.returns.conditionOf', { name: label })} className="col-start-2 flex gap-1.5 sm:col-start-auto">
                  {(['reusable', 'damaged'] as const).map(condition => <label key={condition} className="relative cursor-pointer">
                    <input type="radio" name={field.name} value={condition} checked={field.value === condition} disabled={mutation.isPending} className="peer sr-only" onChange={() => { remember(row); field.onChange(condition) }} />
                    <span className="flex min-h-11 items-center rounded-md border border-border px-3 text-sm peer-checked:border-primary peer-checked:bg-primary-soft peer-checked:text-primary-text peer-focus-visible:ring-2 peer-focus-visible:ring-ring">{t(`assets.uniform.${condition}`)}</span>
                    <span aria-hidden="true" className="absolute end-0 top-0 hidden rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground peer-checked:block">✓</span>
                  </label>)}
                </div>} />
              </fieldset>
            })}
        </section>
      </DialogBody>
      <DialogFooter>
        <div className="me-auto text-xs text-muted-foreground"><p>{t('assets.uniform.receiver', { name: receiver })}</p><p>{t('assets.uniform.today', { date: formatDmy(todayIso()) })}</p></div>
        <div className="text-end text-xs"><p>{total > 0 && t('assets.uniform.itemsN', { count: total })}</p><p id={`${id}-reason`} role="status" className="text-muted-foreground">{reason}</p></div>
        <div className="flex gap-2 max-sm:w-full"><Button type="button" variant="secondary" className="min-h-11 max-sm:flex-1" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>{t('assets.uniform.cancel')}</Button><Button type="submit" className="min-h-11 max-sm:flex-1" disabled={!!reason || mutation.isPending} aria-describedby={`${id}-reason`}>{t('assets.uniform.save')}</Button></div>
      </DialogFooter>
    </form>
  </DialogShell>
}
