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
import { type UniformItemRead, type UniformReturnLine, type UniformReturnRead } from '@/lib/api'
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
  rows: z.record(z.string(), z.object({ qty: z.string(), condition: z.enum(['reusable', 'damaged']) })),
})
type Values = z.infer<typeof schema>

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
  const holdings = useUniformEmployee(employee?.id ?? '')
  const { control, setValue, reset, handleSubmit } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { employeeId: initialEmployee?.id ?? '', rows: {} },
  })
  const drafts = useWatch({ control, name: 'rows' })
  const rows = (holdings.data?.holdings ?? []).filter(holding => holding.qty > 0).map(holding => {
    const key = `${holding.item_id}:${holding.size_id ?? ''}`
    const draft = drafts[key]
    const condition: UniformReturnLine['condition'] = draft?.condition ?? 'reusable'
    return { key, holding, qty: Math.min(holding.qty, whole(draft?.qty ?? '0')), condition }
  })
  const name = (item?: UniformItemRead) => item ? i18n.language.startsWith('ar') ? item.name_ar : item.name_en : ''
  const sizeLabel = (item: UniformItemRead | undefined, sizeId: number | null) => {
    const label = item?.sizes.find(size => size.id === sizeId)?.label
    return !label ? null : label === 'one' ? t('assets.uniform.oneSize') : <bdi dir="ltr">{label}</bdi>
  }
  const total = rows.reduce((sum, row) => sum + row.qty, 0)
  const loading = !!employee && (holdings.isPending || items.isPending)
  const reason = !employee ? t('assets.uniform.needReturnEmployee') : holdings.isError || items.isError ? t('assets.uniform.error') : loading ? t('assets.uniform.loading') : !total ? t('assets.uniform.needReturnQty') : ''
  const receiver = user ? pickEmployeeName({ name_en: user.name_en || user.email, name_ar: user.name_ar }, i18n.language) : ''
  function choose(next: UniformEmployee | null) {
    setEmployee(next)
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
        <FormAlert id={`${id}-error`} message={mutation.error ? uniformErrorMessage(mutation.error) : null} />
        <EmployeeSearch recipientsOnly value={employee} inputRef={searchRef} disabled={mutation.isPending} onChange={choose} />
        <section aria-labelledby={`${id}-held`}>
          <h3 id={`${id}-held`} className="mb-2 mt-2 text-sm font-semibold">{t('assets.uniform.currentlyHolds')}</h3>
          {!employee ? <p className="text-sm text-muted-foreground">{t('assets.uniform.needReturnEmployee')}</p>
            : holdings.isError || items.isError ? <div><p role="alert" className="text-sm text-destructive-text">{t('assets.uniform.error')}</p><Button type="button" variant="ghost" className="min-h-11" onClick={() => { void holdings.refetch(); void items.refetch() }}>{t('assets.uniform.retry')}</Button></div>
            : loading ? <p role="status" className="text-sm text-muted-foreground">{t('assets.uniform.loading')}</p>
            : rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('assets.uniform.holdsNone')}</p>
            : rows.map(row => {
              const item = items.data?.find(entry => entry.id === row.holding.item_id)
              const held = row.holding.qty
              const size = item?.tracking === 'shelf' ? sizeLabel(item, row.holding.size_id) : null
              const rawSize = item?.tracking === 'shelf' ? item.sizes.find(entry => entry.id === row.holding.size_id)?.label : undefined
              const label = !rawSize ? name(item) : `${name(item)} ${rawSize === 'one' ? t('assets.uniform.oneSize') : rawSize}`
              return <fieldset key={row.key} disabled={mutation.isPending} aria-labelledby={`${id}-line-${row.key}`} className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t border-hairline py-3 sm:grid-cols-[44px_minmax(0,1fr)_auto_auto]">
                {item ? <UniformArt kind={item.drawing} size={44} className="shrink-0" /> : <span />}
                <div className="min-w-0"><span id={`${id}-line-${row.key}`} dir="auto" className="block text-sm font-semibold">{name(item)}</span>
                  <span className="block text-xs text-muted-foreground">{size && <>{size} · </>}{t('assets.uniform.holdsN', { count: held })}</span></div>
                <div className="col-start-2 flex items-center justify-self-start rounded-md border border-border sm:col-start-auto">
                  <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" disabled={mutation.isPending || row.qty <= 0} aria-label={t('assets.uniform.dec', { name: label })} onClick={() => setValue(`rows.${row.key}.qty`, String(Math.max(0, row.qty - 1)))}><Minus aria-hidden className="h-4 w-4" /></Button>
                  <Controller control={control} name={`rows.${row.key}.qty`} defaultValue="0" render={({ field }) => <Input {...field} type="number" min={0} max={held} step={1} inputMode="numeric" dir="ltr" aria-label={t('assets.uniform.qtyOf', { name: label })}
                    className="min-h-11 w-16 border-0 px-1 text-center tabular-nums shadow-none"
                    onBlur={() => { field.onBlur(); field.onChange(String(Math.min(held, whole(field.value)))) }}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} />} />
                  <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" disabled={mutation.isPending || row.qty >= held} aria-label={t('assets.uniform.inc', { name: label })} onClick={() => setValue(`rows.${row.key}.qty`, String(Math.min(held, row.qty + 1)))}><Plus aria-hidden className="h-4 w-4" /></Button>
                </div>
                <Controller control={control} name={`rows.${row.key}.condition`} defaultValue="reusable" render={({ field }) => <div role="radiogroup" aria-label={t('assets.uniform.returns.conditionOf', { name: label })} className="col-start-2 flex gap-1.5 sm:col-start-auto">
                  {(['reusable', 'damaged'] as const).map(condition => <label key={condition} className="relative cursor-pointer">
                    <input type="radio" name={field.name} value={condition} checked={field.value === condition} disabled={mutation.isPending} className="peer sr-only" onChange={() => field.onChange(condition)} />
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
