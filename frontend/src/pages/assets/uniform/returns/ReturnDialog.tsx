import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Minus, Plus } from 'lucide-react'

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
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { type UniformEmployee } from '../EmployeeSearch'
import { uniformErrorMessage, useCreateUniformReturn, useUniformEmployee, useUniformItems, useUniformRecipients } from '../uniformQueries'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Preselects the person, as the Received panel does. */
  employee?: UniformEmployee
  returnFocusRef?: React.RefObject<HTMLElement | null>
  onSuccess?: (record: UniformReturnRead) => void
}

type Condition = UniformReturnLine['condition']
interface Row { key: string; holding: UniformHolding; qty: number; condition: Condition }

/** Floors and clamps a typed quantity into 0..held. */
function clampReturnQty(raw: string | number, held: number): number {
  const number = Number(raw)
  return Math.min(held, Math.max(0, Number.isFinite(number) ? Math.floor(number) : 0))
}

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
  const [rows, setRows] = useState<Row[]>([])
  const [seeded, setSeeded] = useState<string | null>(null)
  if (employee && holdings.data && seeded !== employee.id) {
    setSeeded(employee.id)
    setRows(holdings.data.holdings.filter(holding => holding.qty > 0).map(holding => ({ key: `${holding.item_id}:${holding.size_id ?? ''}`, holding, qty: 0, condition: 'reusable' })))
  }
  const name = (item?: UniformItemRead) => item ? i18n.language.startsWith('ar') ? item.name_ar : item.name_en : ''
  const sizeLabel = (item: UniformItemRead | undefined, sizeId: number | null) => {
    const label = item?.sizes.find(size => size.id === sizeId)?.label
    return !label ? null : label === 'one' ? t('assets.uniform.oneSize') : <bdi dir="ltr">{label}</bdi>
  }
  const total = rows.reduce((sum, row) => sum + row.qty, 0)
  const loading = !!employee && (holdings.isPending || items.isPending)
  const reason = !employee ? t('assets.uniform.needReturnEmployee') : loading ? t('assets.uniform.loading') : !total ? t('assets.uniform.needReturnQty') : ''
  const receiver = user ? pickEmployeeName({ name_en: user.name_en || user.email, name_ar: user.name_ar }, i18n.language) : ''
  const update = (key: string, patch: Partial<Row>) => setRows(previous => previous.map(row => row.key === key ? { ...row, ...patch } : row))
  function choose(next: UniformEmployee | null) {
    setEmployee(next)
    setRows([])
    setSeeded(null)
    if (!next) requestAnimationFrame(() => searchRef.current?.focus())
  }
  return <DialogShell open={open} onOpenChange={onOpenChange} title={t('assets.uniform.returnTitle')} description={t('assets.uniform.conditionHint')} size="xl" busy={mutation.isPending} returnFocusRef={returnFocusRef}
    onOpenAutoFocus={event => { if (!initialEmployee && searchRef.current) { event.preventDefault(); searchRef.current.focus() } }}>
    <form noValidate aria-busy={mutation.isPending} className="flex min-h-0 flex-1 flex-col" onSubmit={event => {
      event.preventDefault()
      if (reason || mutation.isPending || !employee) return
      const lines: UniformReturnLine[] = rows.filter(row => row.qty > 0).map(row => ({ item_id: row.holding.item_id, ...(row.holding.size_id == null ? {} : { size_id: row.holding.size_id }), qty: row.qty, condition: row.condition }))
      mutation.mutate({ employee_id: employee.id, returned_on: todayIso(), lines }, {
        onSuccess: record => {
          toast.success(t('assets.uniform.returnSaved', { count: total }))
          onSuccess?.(record)
          onOpenChange(false)
        },
      })
    }}>
      <DialogBody>
        <FormAlert id={`${id}-error`} message={mutation.error ? uniformErrorMessage(mutation.error) : null} />
        <HolderSearch value={employee} inputRef={searchRef} disabled={mutation.isPending} onChange={choose} />
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
                  <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" disabled={mutation.isPending || row.qty <= 0} aria-label={t('assets.uniform.dec', { name: label })} onClick={() => update(row.key, { qty: clampReturnQty(row.qty - 1, held) })}><Minus aria-hidden className="h-4 w-4" /></Button>
                  <QtyInput value={row.qty} held={held} label={t('assets.uniform.qtyOf', { name: label })} onCommit={qty => update(row.key, { qty })} />
                  <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" disabled={mutation.isPending || row.qty >= held} aria-label={t('assets.uniform.inc', { name: label })} onClick={() => update(row.key, { qty: clampReturnQty(row.qty + 1, held) })}><Plus aria-hidden className="h-4 w-4" /></Button>
                </div>
                <div role="radiogroup" aria-label={t('assets.uniform.returns.conditionOf', { name: label })} className="col-start-2 flex gap-1.5 sm:col-start-auto">
                  {(['reusable', 'damaged'] as const).map(condition => <label key={condition} className="relative cursor-pointer">
                    <input type="radio" name={`${id}-condition-${row.key}`} value={condition} checked={row.condition === condition} disabled={mutation.isPending} className="peer sr-only" onChange={() => update(row.key, { condition })} />
                    <span className="flex min-h-11 items-center rounded-md border border-border px-3 text-sm peer-checked:border-primary peer-checked:bg-primary-soft peer-checked:text-primary-text peer-focus-visible:ring-2 peer-focus-visible:ring-ring">{t(`assets.uniform.${condition}`)}</span>
                  </label>)}
                </div>
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

/** Keeps the typed text until commit, then floors and clamps it. */
function QtyInput({ value, held, label, onCommit }: { value: number; held: number; label: string; onCommit: (qty: number) => void }): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  return <Input type="number" min={0} max={held} step={1} inputMode="numeric" dir="ltr" aria-label={label} value={draft ?? String(value)}
    className="min-h-11 w-16 border-0 px-1 text-center tabular-nums shadow-none"
    onChange={event => setDraft(event.target.value)}
    onBlur={() => { if (draft !== null) onCommit(clampReturnQty(draft, held)); setDraft(null) }}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} />
}

/** Searches only current holders: recipients whose net holding is above zero. */
function HolderSearch({ value, onChange, inputRef, disabled }: { value: UniformEmployee | null; onChange: (employee: UniformEmployee | null) => void; inputRef: React.RefObject<HTMLInputElement | null>; disabled: boolean }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [query, setQuery] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const debounced = useDebouncedValue(query, 250).trim()
  const recipients = useUniformRecipients(debounced)
  const all = useUniformRecipients('')
  const matches = (recipients.data ?? []).filter(row => row.held_total > 0).slice(0, 8).map(row => ({ id: row.employee_id, name_en: row.name_en, name_ar: row.name_ar }))
  const nobody = all.isSuccess && !all.data.some(row => row.held_total > 0)
  const showResults = !value && !dismissed && !!query.trim() && query.trim() === debounced
  useEffect(() => { resultRefs.current = [] }, [debounced])
  function dismiss(event: React.KeyboardEvent) {
    event.preventDefault()
    event.stopPropagation()
    setDismissed(true)
    inputRef.current?.focus()
  }
  function choose(employee: UniformEmployee) {
    setQuery('')
    onChange(employee)
  }
  if (value) return <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-raised p-3">
    <div className="min-w-0"><p className="text-xs text-muted-foreground">{t('assets.uniform.returnedBy')}</p><p className="break-words font-semibold" dir="auto">{pickEmployeeName(value, i18n.language)}</p><bdi dir="ltr" className="text-sm text-muted-foreground">{value.id}</bdi></div>
    <Button type="button" variant="secondary" className="min-h-11" disabled={disabled} onClick={() => { onChange(null); setDismissed(false) }}>{t('assets.uniform.change')}</Button>
  </div>
  return <section className="min-w-0 space-y-2">
    <label htmlFor={id} className="block text-sm font-semibold">{t('assets.uniform.returnedBy')}</label>
    <Input ref={inputRef} id={id} type="search" role="searchbox" dir="auto" autoComplete="off" disabled={disabled} placeholder={t('assets.uniform.pickerPh')} value={query} className="min-h-11"
      onChange={event => { setQuery(event.target.value); setDismissed(false) }}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          if (showResults && recipients.isSuccess && matches.length === 1) choose(matches[0])
        } else if (event.key === 'ArrowDown' && showResults) { event.preventDefault(); resultRefs.current[0]?.focus() }
        else if (event.key === 'Escape' && showResults) dismiss(event)
      }} />
    {nobody && <p className="text-sm text-muted-foreground">{t('assets.uniform.returnEmpty')}</p>}
    {showResults && <ul className="overflow-hidden rounded-md border border-border">
      {recipients.isPending && <li role="status" className="p-3 text-sm text-muted-foreground">{t('assets.uniform.loading')}</li>}
      {recipients.isError && <li className="flex flex-wrap items-center gap-2 p-3"><span role="alert" className="text-sm text-destructive-text">{t('assets.uniform.errorPeople')}</span><Button type="button" variant="ghost" className="min-h-11" onClick={() => void recipients.refetch()}>{t('assets.uniform.retry')}</Button></li>}
      {recipients.isSuccess && matches.length === 0 && <li className="p-3 text-sm text-muted-foreground">{t('assets.uniform.pickerEmpty')}</li>}
      {recipients.isSuccess && matches.map((employee, index) => <li key={employee.id} className="border-b border-hairline last:border-0">
        <button type="button" ref={button => { resultRefs.current[index] = button }} className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-start hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => choose(employee)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); resultRefs.current[Math.min(matches.length - 1, index + 1)]?.focus() }
            else if (event.key === 'ArrowUp') { event.preventDefault(); if (index === 0) inputRef.current?.focus(); else resultRefs.current[index - 1]?.focus() }
            else if (event.key === 'Escape') dismiss(event)
          }}>
          <span dir="auto" className="font-medium">{pickEmployeeName(employee, i18n.language)}</span><bdi dir="ltr" className="text-sm text-muted-foreground">{employee.id}</bdi><span className="text-sm">{t('assets.uniform.choose')}</span>
        </button>
      </li>)}
    </ul>}
  </section>
}
