import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpFromLine, Search } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Input } from '@/components/ui/input'
import { api, type StoreMovementRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'
import { MovementDetailDialog, MovementRow } from './components/MovementRow'
import { StoreQueryState } from './StoreQueryState'
import { StoreShell } from './StoreShell'
import { storeKeys } from './storeUtils'

export function StoreMovementsPage() {
  const { t, i18n } = useTranslation()
  const { has } = useCapabilities()
  const [kind, setKind] = useState<'all' | StoreMovementRead['kind']>('all')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [selected, setSelected] = useState<StoreMovementRead | null>(null)
  const query = useQuery({
    queryKey: from || to ? [...storeKeys.movements, { from, to }] : storeKeys.movements,
    queryFn: () => api.listStoreMovements({ from: from || undefined, to: to || undefined }),
  })
  const rows = useMemo(() => query.data ?? [], [query.data])
  const groups = useMemo(() => {
    const grouped = new Map<string, StoreMovementRead[]>()
    const q = search.trim().toLocaleLowerCase()
    for (const row of rows) {
      if (kind !== 'all' && row.kind !== kind) continue
      if (q && ![row.taken_by, row.note, row.recorded_by_name, row.recorded_by_name_ar, ...row.lines.flatMap(line => [line.item_code, line.item_name_en, line.item_name_ar])].some(value => value?.toLocaleLowerCase().includes(q))) continue
      const month = row.on.slice(0, 7)
      const group = grouped.get(month)
      if (group) group.push(row)
      else grouped.set(month, [row])
    }
    return grouped
  }, [rows, kind, search])
  const resultCount = [...groups.values()].reduce((total, group) => total + group.length, 0)
  const filtered = kind !== 'all' || !!search.trim() || !!from || !!to
  const emptyMessage = t(`assets.store.movements.${filtered ? 'empty' : 'trueEmpty'}`)
  return <StoreShell title={t('assets.store.movements.title')} description={t('assets.store.movements.description')} actions={has('store.edit') ? <Link className={buttonVariants({ className: 'min-h-11' })} to="/holdings/store?pick=1"><ArrowUpFromLine aria-hidden className="me-2 size-4" />{t('assets.store.movements.handOut')}</Link> : undefined}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">{(['all', 'in', 'out', 'disposed'] as const).map(value => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)} className={cn('inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', kind === value ? 'border-primary bg-primary/10 font-semibold text-primary-text' : 'border-border text-muted-foreground hover:bg-muted')} >{t(`assets.store.movements.filter.${value}`)}<bdi dir="ltr" className="text-xs tabular-nums">{query.isSuccess ? (value === 'all' ? rows.length : rows.filter(row => row.kind === value).length) : '–'}</bdi></button>)}</div>
      <label className="relative w-full sm:w-64"><Search aria-hidden className="pointer-events-none absolute start-3 top-3 size-4 text-muted-foreground" /><span className="sr-only">{t('assets.store.movements.search')}</span><Input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('assets.store.movements.search')} className="min-h-11 ps-9" /></label>
    </div>
    <fieldset className="mt-3 flex flex-wrap items-end gap-3">
      <legend className="mb-2 text-sm font-medium">{t('assets.store.movements.dateRange')}</legend>
      <label className="flex min-w-0 flex-col gap-1 text-sm">{t('assets.store.movements.fromDate')}<bdi dir="ltr"><Input type="date" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)} className="min-h-11" /></bdi></label>
      <label className="flex min-w-0 flex-col gap-1 text-sm">{t('assets.store.movements.toDate')}<bdi dir="ltr"><Input type="date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} className="min-h-11" /></bdi></label>
      <Button type="button" variant="ghost" className="min-h-11" disabled={!from && !to} onClick={() => { setFrom(''); setTo('') }}>{t('assets.store.movements.clearDates')}</Button>
    </fieldset>
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{query.isSuccess && (resultCount ? <Trans i18nKey="assets.store.movements.recordCount" count={resultCount} components={{ count: <bdi dir="ltr" /> }} /> : emptyMessage)}</p>
    <StoreQueryState isPending={query.isPending} error={query.error} onRetry={() => { void query.refetch() }} isEmpty={groups.size === 0} emptyMessage={emptyMessage} emptyDescription={t(`assets.store.movements.${filtered ? 'filteredEmptyDescription' : 'trueEmptyDescription'}`)}>
      {[...groups].map(([month, movements]) => <section key={month}><h2 className="mb-2 mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground rtl:tracking-normal"><bdi dir="ltr">{new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(new Date(`${month}-01T12:00:00`))}</bdi></h2><div className="overflow-hidden rounded-xl border border-border bg-card">{movements.map(movement => <MovementRow key={`${movement.kind}-${movement.id}`} movement={movement} onSelect={setSelected} />)}</div></section>)}
    </StoreQueryState><MovementDetailDialog movement={selected} open={selected !== null} onOpenChange={open => { if (!open) setSelected(null) }} />
  </StoreShell>
}
