import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { UniformArt } from '@/components/UniformArt'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { type UniformItemRead, type UniformReturnRead } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { formatDmy } from '@/lib/formatDmy'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'
import { useUniformItems, useUniformRecipients, useUniformReturns } from '../uniformQueries'
import { VoidDialog } from '../VoidDialog'

/** Return list with a sticky detail; one region with Back below 1000px. */
export function ReturnsTab(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const editable = useCapabilities().has('uniform.edit')
  const [params, setParams] = useSearchParams()
  const returns = useUniformReturns()
  const items = useUniformItems(true)
  const people = useUniformRecipients('')
  const [query, setQuery] = useState('')
  const [voiding, setVoiding] = useState<UniformReturnRead | null>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const voidOpener = useRef<HTMLElement | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const ar = i18n.language.startsWith('ar')
  const person = (employeeId: string) => {
    const row = people.data?.find(entry => entry.employee_id === employeeId)
    return row ? pickEmployeeName({ name_en: row.name_en, name_ar: row.name_ar }, i18n.language) : employeeId
  }
  const item = (itemId: number): UniformItemRead | undefined => items.data?.find(entry => entry.id === itemId)
  const size = (line: UniformReturnRead['lines'][number]) => {
    const piece = item(line.item_id)
    const label = piece?.tracking === 'shelf' ? piece.sizes.find(entry => entry.id === line.size_id)?.label : undefined
    return !label ? null : label === 'one' ? t('assets.uniform.oneSize') : <bdi dir="ltr">{label}</bdi>
  }
  const needle = query.trim().toLocaleLowerCase()
  const records = (returns.data ?? []).filter(record => {
    const recipient = people.data?.find(entry => entry.employee_id === record.employee_id)
    return !needle || [record.employee_id, recipient?.name_en ?? '', recipient?.name_ar ?? ''].some(value => value.toLocaleLowerCase().includes(needle))
  })
  const requested = params.get('return')
  const candidate = requested !== null
    ? returns.data?.find(record => String(record.id) === requested)
    : records[0]
  const selected = voiding ?? candidate
  const open = requested !== null
  function select(record: UniformReturnRead) {
    setParams(previous => { const next = new URLSearchParams(previous); next.set('return', String(record.id)); return next })
    requestAnimationFrame(() => detailHeading.current?.focus())
  }
  function back() {
    const id = selected?.id
    setParams(previous => { const next = new URLSearchParams(previous); next.delete('return'); return next })
    requestAnimationFrame(() => (document.querySelector<HTMLElement>(`[data-return-card="${id}"]`) ?? searchInput.current)?.focus())
  }

  if (returns.isError && returns.data === undefined) return <section className="rounded-xl border border-border bg-surface p-4"><p role="alert" className="text-sm text-destructive-text">{t('assets.uniform.errorReturns')}</p><Button type="button" variant="ghost" className="min-h-11" onClick={() => void returns.refetch()}>{t('assets.uniform.retry')}</Button></section>
  return <div className="grid items-start gap-4 min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    {(returns.isError || items.isError || people.isError) && <div className="col-span-full rounded-xl border border-border bg-surface p-4">
      {(returns.isError || (items.isError && items.data !== undefined) || (people.isError && people.data !== undefined)) && <p role="alert" className="text-sm text-destructive-text">{t('assets.uniform.refreshRecordsError')}</p>}
      {items.isError && items.data === undefined && <p role="alert" className="text-sm text-destructive-text">{t('assets.uniform.error')}</p>}
      {people.isError && people.data === undefined && <p role="alert" className="text-sm text-destructive-text">{t('assets.uniform.errorPeople')}</p>}
      <Button type="button" variant="ghost" className="min-h-11" onClick={() => { void Promise.all([returns.refetch(), items.refetch(), people.refetch()]) }}>{t('assets.uniform.retry')}</Button>
    </div>}
    <section aria-labelledby="uniform-returns-h" className={cn('overflow-hidden rounded-xl border border-border bg-surface', open && returns.data !== undefined && 'max-[999px]:hidden')}>
      <h2 id="uniform-returns-h" className="sr-only">{t('assets.uniform.tabReturns')}</h2>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
        <label className="min-w-0 flex-1"><span className="sr-only">{t('assets.uniform.returnSearch')}</span>
          <Input ref={searchInput} type="search" dir="auto" className="min-h-11" placeholder={t('assets.uniform.searchPh')} value={query} onChange={event => setQuery(event.target.value)} /></label>
        {returns.data !== undefined && <span className="text-sm text-muted-foreground">{t('assets.uniform.returnCount', { count: records.length })}</span>}
      </div>
      {returns.data === undefined ? <div aria-busy="true" className="p-4"><p role="status" className="mb-3 text-sm text-muted-foreground">{t('assets.uniform.loading')}</p>{[0, 1, 2].map(row => <Skeleton key={row} className="mb-3 h-16 w-full" />)}</div>
        : records.length === 0 ? <p className="p-5 text-sm text-muted-foreground">{returns.data.length ? t('assets.uniform.noMatch') : t('assets.uniform.returnsNone')}</p>
        : <ol className="divide-y divide-hairline">{records.map(record => <li key={record.id}>
          <button type="button" data-return-card={record.id} aria-current={selected?.id === record.id ? 'true' : undefined} onClick={() => select(record)}
            className="relative block w-full px-4 py-4 text-start hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=true]:bg-primary-soft aria-[current=true]:before:absolute aria-[current=true]:before:inset-y-0 aria-[current=true]:before:start-0 aria-[current=true]:before:w-0.5 aria-[current=true]:before:bg-primary">
            <span className="flex flex-wrap items-baseline justify-between gap-2"><span dir="auto" className="font-semibold">{person(record.employee_id)}</span><span className="text-xs text-muted-foreground">{formatDmy(record.returned_on)}</span></span>
            <bdi dir="ltr" className="block text-xs text-muted-foreground">{record.employee_id}</bdi>
            {record.voided_at && <span className="mt-1 inline-block rounded border border-border px-1.5 text-xs text-muted-foreground">{t('assets.uniform.voidStatus')}</span>}
            <span className="mt-2 flex flex-wrap gap-2">{record.lines.map((line, index) => {
              const piece = item(line.item_id)
              return <span key={index} className="inline-flex items-center gap-1 text-xs">{piece && <UniformArt kind={piece.drawing} size={30} />}<span className="sr-only" dir="auto">{piece ? ar ? piece.name_ar : piece.name_en : ''}</span>{size(line)}<span className="tabular-nums" dir="ltr">× {line.qty}</span></span>
            })}</span>
          </button>
        </li>)}</ol>}
    </section>
    {returns.data !== undefined && selected && <section aria-labelledby="uniform-return-h" className={cn('rounded-xl border border-border bg-surface p-4 min-[1000px]:sticky min-[1000px]:top-4', !open && 'max-[999px]:hidden')}>
      <Button type="button" variant="secondary" className="mb-3 min-h-11 min-[1000px]:hidden" onClick={back}>{t('assets.uniform.back')}</Button>
      <h2 id="uniform-return-h" ref={detailHeading} tabIndex={-1} dir="auto" className="text-lg font-semibold outline-none">{person(selected.employee_id)}</h2>
      <p className="text-sm text-muted-foreground"><bdi dir="ltr">{selected.employee_id}</bdi> · {formatDmy(selected.returned_on)}</p>
      <p className="mt-1 text-sm text-muted-foreground" dir="auto">{t('assets.uniform.receivedBy', { name: `\u2068${pickEmployeeName({ name_en: selected.received_by_name_en || t('assets.uniform.received.unknownActor'), name_ar: selected.received_by_name_ar }, i18n.language)}\u2069` })}</p>
      {selected.voided_at && <p className="mt-2 rounded-md border border-border bg-surface-raised p-2 text-sm"><span className="font-semibold">{t('assets.uniform.voidStatus')}</span>{selected.void_reason && <>{' · '}<span dir="auto">{selected.void_reason}</span></>}</p>}
      <h3 className="mb-1 mt-4 text-sm font-semibold">{t('assets.uniform.returnedPieces')}</h3>
      <ul className="divide-y divide-hairline">{selected.lines.map((line, index) => {
        const piece = item(line.item_id)
        return <li key={index} className="flex items-center gap-3 py-2">{piece && <UniformArt kind={piece.drawing} size={40} className="shrink-0" />}
          <span className="min-w-0 flex-1"><span dir="auto" className="block text-sm font-medium">{piece ? ar ? piece.name_ar : piece.name_en : ''}</span><span className="block text-xs text-muted-foreground">{size(line)}{size(line) && ' · '}{t(`assets.uniform.${line.condition}`)}</span></span>
          <span className="tabular-nums" dir="ltr">× {line.qty}</span></li>
      })}</ul>
      <p className="mt-2 text-sm">{t('assets.uniform.itemsN', { count: selected.lines.reduce((sum, line) => sum + line.qty, 0) })}</p>
      {selected.note && <p className="mt-2 text-sm" dir="auto"><span className="text-muted-foreground">{t('assets.uniform.note')}: </span>{selected.note}</p>}
      {editable && !selected.voided_at && <Button type="button" variant="ghost" className="mt-4 min-h-11 text-destructive-text" onClick={event => { voidOpener.current = event.currentTarget; setVoiding(selected) }}>{t('assets.uniform.voidRecord')}</Button>}
      {voiding && <VoidDialog open kind="return" recordId={voiding.id}
        returnFocusRef={candidate?.id === voiding.id && !candidate.voided_at ? voidOpener : candidate || requested !== null ? detailHeading : searchInput}
        onOpenChange={open => { if (!open) setVoiding(null) }} />}
    </section>}
    {returns.data !== undefined && !selected && open && <section aria-labelledby="uniform-return-h" className="rounded-xl border border-border bg-surface p-4">
      <Button type="button" variant="secondary" className="mb-3 min-h-11" onClick={back}>{t('assets.uniform.back')}</Button>
      <h2 id="uniform-return-h" ref={detailHeading} tabIndex={-1} className="text-sm outline-none">{t('assets.uniform.returns.unavailable')}</h2>
    </section>}
  </div>
}
