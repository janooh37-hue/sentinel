import { useEffect, useId, useRef, useState } from 'react'
import { type UseMutationResult } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Minus, Plus } from 'lucide-react'

import { DialogBody, DialogFooter, DialogShell, FormAlert } from '@/components/forms/DialogShell'
import { UniformArt } from '@/components/UniformArt'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type UniformIssueCreate, type UniformIssueLine, type UniformIssueRead, type UniformItemRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { pickEmployeeName } from '@/lib/employeeName'
import { formatDmy } from '@/lib/formatDmy'
import { todayIso } from '@/lib/leaveDateMath'
import { toast } from '@/lib/toast'
import { useCapabilities } from '@/lib/useCapabilities'
import { EmployeeSearch, type UniformEmployee } from './EmployeeSearch'
import { whole } from './quantity'
import { uniformErrorMessage, useCreateUniformIssue, useUniformItems } from './uniformQueries'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A holder item shortcut, never inferred from its drawing. */
  itemId?: number
  employee?: UniformEmployee
  returnFocusRef?: React.RefObject<HTMLElement | null>
  onSuccess?: (lines: UniformIssueLine[]) => void
}

const schema = z.object({
  employeeId: z.string().min(1),
  picks: z.record(z.string(), z.object({ choice: z.string(), qty: z.string().optional() })),
})
type Values = z.infer<typeof schema>
const groups = ['formal', 'guard', 'winter'] as const

function quantity(value: string, max: number): number {
  return Math.min(max, Math.max(1, whole(value)))
}
function maximum(item: UniformItemRead, choice: string): number {
  return item.tracking === 'holder' ? Infinity : item.sizes.find(size => String(size.id) === choice && !size.archived_at)?.on_hand ?? 0
}

export function HandOutDialog(props: Props): React.JSX.Element | null {
  const editable = useCapabilities().has('uniform.edit')
  // Mount a fresh form for each opening, as with the existing record dialogs.
  return editable && props.open ? <HandOutContent {...props} /> : null
}

function HandOutContent({ open, onOpenChange, itemId, employee: initialEmployee, returnFocusRef, onSuccess }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const items = useUniformItems()
  const mutation = useCreateUniformIssue()
  const searchRef = useRef<HTMLInputElement>(null)
  return <DialogShell open={open} onOpenChange={onOpenChange} title={t('assets.uniform.giveTitle')} description={t('assets.uniform.tagline')} size="xl" busy={mutation.isPending} returnFocusRef={returnFocusRef}
    onOpenAutoFocus={event => { if (!initialEmployee && searchRef.current) { event.preventDefault(); searchRef.current.focus() } }}>
    {items.data && !items.isError ? <HandOutForm items={items.data.filter(item => !item.archived_at)} itemId={itemId} initialEmployee={initialEmployee} searchRef={searchRef} mutation={mutation} onOpenChange={onOpenChange} onSuccess={onSuccess} /> : <>
      <DialogBody>{items.isError ? <div><p role="alert" className="text-sm text-destructive-text">{t('assets.uniform.error')}</p><Button type="button" variant="ghost" className="min-h-11" onClick={() => void items.refetch()}>{t('assets.uniform.retry')}</Button></div> : <p role="status">{t('assets.uniform.loading')}</p>}</DialogBody>
      <DialogFooter><Button type="button" variant="secondary" className="min-h-11" onClick={() => onOpenChange(false)}>{t('assets.uniform.cancel')}</Button><Button disabled aria-describedby="uniform-load-reason" className="min-h-11">{t('assets.uniform.giveSave')}</Button><span id="uniform-load-reason" className="text-sm text-muted-foreground">{t(items.isError ? 'assets.uniform.error' : 'assets.uniform.loading')}</span></DialogFooter>
    </>}
  </DialogShell>
}

function HandOutForm({ items, itemId, initialEmployee, searchRef, mutation, onOpenChange, onSuccess }: {
  items: UniformItemRead[]
  itemId?: number
  initialEmployee?: UniformEmployee
  searchRef: React.RefObject<HTMLInputElement | null>
  mutation: UseMutationResult<UniformIssueRead, Error, UniformIssueCreate>
  onOpenChange: Props['onOpenChange']
  onSuccess: Props['onSuccess']
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const id = useId()
  const [employee, setEmployee] = useState<UniformEmployee | null>(initialEmployee ?? null)
  const [notices, setNotices] = useState<Record<number, number>>({})
  useEffect(() => {
    if (!initialEmployee) searchRef.current?.focus()
  }, [initialEmployee, searchRef])
  const { control, setValue, handleSubmit } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { employeeId: initialEmployee?.id ?? '', picks: Object.fromEntries(items.map(item => [item.id, { choice: item.id === itemId && item.tracking === 'holder' ? 'give' : 'none', qty: String(item.default_qty) }])) },
  })
  const picks = useWatch({ control, name: 'picks' })
  const selected = items.flatMap(item => {
    const pick = picks[item.id]
    if (!pick || pick.choice === 'none' || maximum(item, pick.choice) < 1) return []
    return [{ item_id: item.id, ...(item.tracking === 'shelf' ? { size_id: Number(pick.choice) } : {}), qty: quantity(pick.qty ?? String(item.default_qty), maximum(item, pick.choice)) }]
  })
  const count = selected.reduce((sum, line) => sum + line.qty, 0)
  const reason = !employee ? t('assets.uniform.needEmployee') : !count ? t('assets.uniform.needPiece') : ''
  const giver = user ? pickEmployeeName({ name_en: user.name_en || user.email, name_ar: user.name_ar }, i18n.language) : ''
  const name = (item: UniformItemRead) => i18n.language.startsWith('ar') ? item.name_ar : item.name_en
  const commit = (item: UniformItemRead, raw: string) => {
    const max = maximum(item, picks[item.id]?.choice ?? 'none')
    const next = quantity(raw, max)
    setValue(`picks.${item.id}.qty`, String(next))
    if (Number(raw) > max) setNotices(previous => ({ ...previous, [item.id]: max }))
  }
  return <form noValidate aria-busy={mutation.isPending} className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit(() => {
    if (reason || mutation.isPending || !employee || selected.some(line => !Number.isSafeInteger(line.qty))) return
    mutation.mutate({ employee_id: employee.id, issued_on: todayIso(), lines: selected }, {
      onSuccess: () => {
        toast.success(t('assets.uniform.given', { count, name: pickEmployeeName(employee, i18n.language) }))
        onSuccess?.(selected)
        onOpenChange(false)
      },
    })
  })}>
    <DialogBody>
      <FormAlert id={`${id}-error`} message={mutation.error ? uniformErrorMessage(mutation.error) : null} />
      <EmployeeSearch value={employee} inputRef={searchRef} disabled={mutation.isPending} onChange={next => { setEmployee(next); setValue('employeeId', next?.id ?? '') }} />
      {groups.map(group => {
        const rows = items.filter(item => item.group_key === group)
        return rows.length > 0 && <section key={group} aria-labelledby={`${id}-${group}`}><h3 id={`${id}-${group}`} className="mb-2 mt-4 text-sm font-semibold">{t(`assets.uniform.groups.${group}`)}</h3>
          {rows.map(item => {
            const pick = { choice: picks[item.id]?.choice ?? 'none', qty: picks[item.id]?.qty ?? String(item.default_qty) }
            const max = maximum(item, pick.choice)
            const selectedQuantity = quantity(pick.qty, max)
            const notice = Number(pick.qty) > max ? max : notices[item.id]
            const choices = item.tracking === 'holder' ? [{ value: 'give', label: t('assets.uniform.giveChoice'), stock: null }] : item.sizes.filter(size => !size.archived_at).map(size => ({ value: String(size.id), label: size.label === 'one' ? t('assets.uniform.oneSize') : size.label, stock: size.on_hand }))
            return <fieldset key={item.id} disabled={mutation.isPending} aria-labelledby={`${id}-piece-${item.id}`} className="grid min-w-0 grid-cols-[48px_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-hairline py-3 sm:grid-cols-[48px_minmax(110px,150px)_minmax(0,1fr)]">
              <UniformArt kind={item.drawing} size={48} className="shrink-0" />
              <div className="min-w-0"><span id={`${id}-piece-${item.id}`} className="text-sm font-semibold" dir="auto">{name(item)}</span><p dir="auto" className="text-xs text-muted-foreground">{i18n.language.startsWith('ar') ? item.description_ar : item.description_en}</p></div>
              <div className="col-span-full min-w-0 space-y-2 sm:col-span-1">
                <Controller control={control} name={`picks.${item.id}.choice`} defaultValue="none" render={({ field }) => <div className="flex flex-wrap gap-1.5">
                  {[{ value: 'none', label: t('assets.uniform.none'), stock: null }, ...choices].map(choice => <label key={choice.value} className="relative cursor-pointer">
                    <input type="radio" name={field.name} value={choice.value} aria-label={choice.stock === null ? choice.label : `${choice.label} ${t('assets.uniform.leftN', { count: choice.stock })}`} checked={field.value === choice.value} disabled={mutation.isPending || choice.stock === 0} className="peer sr-only" onChange={() => {
                      field.onChange(choice.value)
                      const limit = maximum(item, choice.value)
                      const raw = pick.qty
                      if (choice.value !== 'none') setValue(`picks.${item.id}.qty`, String(quantity(raw, limit)))
                      setNotices(previous => ({ ...previous, [item.id]: choice.value !== 'none' && Number(raw) > limit ? limit : -1 }))
                    }} />
                    <span className="flex min-h-11 min-w-11 flex-col items-center justify-center rounded-md border border-border px-2 py-1 text-sm peer-checked:border-primary peer-checked:bg-primary-soft peer-checked:text-primary-text peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-not-allowed peer-disabled:border-dashed peer-disabled:text-muted-foreground">
                      {choice.value === 'none' || item.tracking === 'holder' || choice.label === t('assets.uniform.oneSize') ? choice.label : <bdi dir="ltr">{choice.label}</bdi>}
                      {choice.stock !== null && <span className="text-xs">{' '}{t('assets.uniform.leftN', { count: choice.stock })}</span>}
                    </span>
                    <span aria-hidden="true" className="absolute end-0 top-0 hidden rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground peer-checked:block">✓</span>
                  </label>)}
                </div>} />
                {pick.choice !== 'none' && <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t('assets.uniform.qty')}</span>
                  <div className="flex items-center rounded-md border border-border">
                    <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" disabled={mutation.isPending || selectedQuantity <= 1} aria-label={t('assets.uniform.dec', { name: name(item) })} onClick={() => commit(item, String(selectedQuantity - 1))}><Minus aria-hidden className="h-4 w-4" /></Button>
                    <Controller control={control} name={`picks.${item.id}.qty`} defaultValue={String(item.default_qty)} render={({ field }) => <Input {...field} type="number" min={1} max={Number.isFinite(max) ? max : undefined} step={1} inputMode="numeric" dir="ltr" aria-label={t('assets.uniform.qtyOf', { name: name(item) })} aria-describedby={`${id}-clamp-${item.id}`} className="min-h-11 w-16 border-0 px-1 text-center tabular-nums shadow-none" onBlur={() => { field.onBlur(); commit(item, field.value ?? String(item.default_qty)) }} />} />
                    <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" disabled={mutation.isPending || selectedQuantity >= max} aria-label={t('assets.uniform.inc', { name: name(item) })} onClick={() => commit(item, String(selectedQuantity + 1))}><Plus aria-hidden className="h-4 w-4" /></Button>
                  </div>
                </div>}
                <p id={`${id}-clamp-${item.id}`} role="status" className="text-xs text-muted-foreground">{notice !== undefined && notice >= 0 && pick.choice !== 'none' ? t('assets.uniform.onlyLeft', { count: notice }) : ''}</p>
              </div>
            </fieldset>
          })}
        </section>
      })}
    </DialogBody>
    <DialogFooter>
      <div className="me-auto text-xs text-muted-foreground"><p>{t('assets.uniform.giver', { name: giver })}</p><p>{t('assets.uniform.today', { date: formatDmy(todayIso()) })}</p></div>
      <div className="text-end text-xs"><p>{count > 0 && t('assets.uniform.giveCount', { count })}</p><p id={`${id}-reason`} role="status" className="text-muted-foreground">{reason}</p></div>
      <div className="flex gap-2 max-sm:w-full"><Button type="button" variant="secondary" className="min-h-11 max-sm:flex-1" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>{t('assets.uniform.cancel')}</Button><Button type="submit" className="min-h-11 max-sm:flex-1" disabled={!!reason || mutation.isPending} aria-describedby={`${id}-reason`}>{t('assets.uniform.giveSave')}</Button></div>
    </DialogFooter>
  </form>
}
