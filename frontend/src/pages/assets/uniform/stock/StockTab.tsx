import { Fragment, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { UniformArt } from '@/components/UniformArt'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { type UniformItemRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIsMobile } from '@/lib/useIsMobile'
import { cn } from '@/lib/utils'
import { useUniformItems, useUniformSummary } from '../uniformQueries'
import { HolderChips } from './HolderChips'
import { AddItemDialog } from './AddItemDialog'
import { ItemEditorDialog } from './ItemEditorDialog'
import { ReceiveStockDialog } from './ReceiveStockDialog'
import { StockHistory } from './StockHistory'

interface Props {
  onHandOut: (opener: HTMLButtonElement, itemId: number) => void
  changedSizes?: number[]
  changeSequence?: number
}

export function StockTab({ onHandOut, changedSizes = [], changeSequence = 0 }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const mobile = useIsMobile()
  const editable = useCapabilities().has('uniform.edit')
  const query = useUniformItems()
  const summary = useUniformSummary()
  const [dialog, setDialog] = useState<{ kind: 'add' | 'edit' | 'receive' | 'history'; item?: UniformItemRead } | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const [catalogueChange, setCatalogueChange] = useState<{ sizes: number[]; sequence: number }>({ sizes: [], sequence: 0 })
  function openDialog(kind: 'add' | 'edit' | 'receive' | 'history', trigger: HTMLButtonElement, item?: UniformItemRead) {
    opener.current = trigger
    setDialog({ kind, item })
  }
  function stockSaved(sizeIds: number[]) {
    setCatalogueChange(previous => ({ sizes: sizeIds, sequence: previous.sequence + 1 }))
  }
  const items = query.data?.filter(item => !item.archived_at) ?? []
  const out = items.flatMap(item => {
    const sizes = item.sizes.filter(size => !size.archived_at && size.on_hand === 0)
    return sizes.length ? [{ item, sizes }] : []
  })
  const name = (item: UniformItemRead) => i18n.language.startsWith('ar') ? item.name_ar : item.name_en
  const identify = (item: UniformItemRead) => <div className="flex min-w-0 items-center gap-3"><UniformArt kind={item.drawing} size={64} className="shrink-0" />
    <div className="min-w-0"><span dir="auto" className="block text-sm font-semibold">{name(item)}</span><span dir="auto" className="block text-xs text-muted-foreground">{i18n.language.startsWith('ar') ? item.description_ar : item.description_en}</span>
      {item.tracking === 'holder' && <span className="block text-xs text-muted-foreground">{t('assets.uniform.heldBy', { count: item.holders.length })}</span>}
    </div>
  </div>
  const balance = (item: UniformItemRead) => item.tracking === 'holder' ? <span className="text-muted-foreground">-</span> : <span className="tabular-nums">{item.sizes.reduce((sum, size) => sum + (size.archived_at ? 0 : size.on_hand), 0)}</span>
  const detail = (item: UniformItemRead) => item.tracking === 'holder' ? <HolderChips holders={item.holders} onGive={opener => onHandOut(opener, item.id)} /> : <ul aria-label={t('assets.uniform.bySize')} className="flex flex-wrap gap-1.5">
    {item.sizes.filter(size => !size.archived_at).map(size => <li key={size.id} data-stock-size={size.id}
      className={cn('relative flex min-w-11 flex-col items-center overflow-hidden rounded-md border px-2 py-1.5 text-primary-text', size.on_hand === 0 ? 'border-dashed border-border bg-transparent' : size.is_low ? 'border-warning bg-warning-soft text-foreground' : 'border-transparent bg-primary-soft')}
      style={size.on_hand > 0 && !size.is_low ? { backgroundColor: `color-mix(in srgb, var(--primary) ${7 + 30 * size.on_hand / Math.max(1, ...item.sizes.map(row => row.on_hand))}%, var(--surface))` } : undefined}>
      <span className="text-xs">{size.label === 'one' ? t('assets.uniform.oneSize') : <bdi dir="ltr">{size.label}</bdi>}</span>
      <span className="text-sm font-medium tabular-nums">{size.on_hand}</span>
      {size.is_low && size.on_hand > 0 && <span className="text-xs text-foreground">{t('assets.uniform.lowStock')}</span>}
      {size.on_hand === 0 && <span className="sr-only">{t('assets.uniform.out')}</span>}
      {(changedSizes.includes(size.id) || catalogueChange.sizes.includes(size.id)) && <span key={`${changeSequence}-${catalogueChange.sequence}`} aria-hidden className="pointer-events-none absolute inset-0 bg-primary opacity-0 motion-safe:animate-[uniform-stock-pulse_600ms_ease-out]" />}
    </li>)}
  </ul>
  const actions = (item: UniformItemRead) => <div className="flex flex-wrap justify-end gap-1">
    {editable && <Button type="button" variant="ghost" className="min-h-11 whitespace-normal" onClick={event => openDialog('edit', event.currentTarget, item)}>{t('assets.uniform.update')}</Button>}
    {editable && item.tracking === 'holder' && <Button type="button" variant="ghost" className="min-h-11 whitespace-normal" onClick={event => onHandOut(event.currentTarget, item.id)}>{t('assets.uniform.giveSuit')}</Button>}
    {item.tracking === 'shelf' && <Button type="button" variant="ghost" className="min-h-11 whitespace-normal" onClick={event => openDialog('history', event.currentTarget, item)}>{t('uniform.catalog.stockHistory')}</Button>}
  </div>
  if (query.isPending) return <section aria-busy="true" aria-label={t('assets.uniform.bySize')} className="rounded-xl border border-border bg-surface p-4"><p role="status" className="mb-4 text-sm text-muted-foreground">{t('assets.uniform.loading')}</p>{[0, 1, 2].map(row => <Skeleton key={row} className="mb-3 h-20 w-full" />)}</section>
  if (query.isError) return <section className="rounded-xl border border-border bg-surface p-4"><p role="alert" className="text-sm text-destructive-text">{t('assets.uniform.error')}</p><Button type="button" variant="ghost" className="min-h-11" onClick={() => { void query.refetch().then(() => document.getElementById('uniform-title')?.focus()) }}>{t('assets.uniform.retry')}</Button></section>
  return <>
    <style>{'@keyframes uniform-stock-pulse { from { opacity: .24; } to { opacity: 0; } }'}</style>
    {editable && <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" className="min-h-11" onClick={event => openDialog('add', event.currentTarget)}>{t('assets.uniform.addItem')}</Button><Button type="button" variant="secondary" className="min-h-11" onClick={event => openDialog('receive', event.currentTarget)}>{t('assets.uniform.receiveStock')}</Button></div>}
    <section aria-label={t('assets.uniform.summary')} className="overflow-hidden rounded-xl border border-border bg-surface">
      <dl className="grid grid-cols-2 md:grid-cols-[minmax(150px,1fr)_minmax(150px,1fr)_2fr]">
        <div className="p-4 md:p-5"><dt className="text-sm text-muted-foreground">{t('assets.uniform.shelf')}</dt><dd className="mt-1 text-2xl tabular-nums">{items.reduce((sum, item) => sum + item.sizes.reduce((total, size) => total + (size.archived_at ? 0 : size.on_hand), 0), 0)}</dd><dd className="mt-1 text-xs text-muted-foreground">{t('assets.uniform.shelfSub')}</dd></div>
        <div className="border-s border-border p-4 md:p-5"><dt className="text-sm text-muted-foreground">{t('assets.uniform.holdersK')}</dt><dd className="mt-1 text-2xl tabular-nums">{new Set(items.flatMap(item => item.holders.map(holder => holder.employee_id))).size}</dd><dd className="mt-1 text-xs text-muted-foreground">{summary.isError ? <span role="alert">{t('assets.uniform.errorPeople')} <button type="button" className="min-h-11 underline" onClick={() => void summary.refetch()}>{t('assets.uniform.retry')}</button></span> : summary.data ? t('assets.uniform.suitsIssued', { count: summary.data.suits_issued }) : t('assets.uniform.loading')}</dd></div>
        <div className="col-span-full border-t border-border p-4 md:col-span-1 md:border-s md:border-t-0 md:p-5"><dt className="text-sm text-muted-foreground">{t('assets.uniform.out')}</dt><dd className="mt-2">{out.length ? <ul className="flex flex-wrap gap-x-5 gap-y-2">{out.map(({ item, sizes }) => <li key={item.id} className="flex items-center gap-2"><UniformArt kind={item.drawing} size={36} /><span className="text-sm"><span dir="auto">{name(item)}</span><span className="block text-xs text-muted-foreground">{sizes.map((size, index) => <Fragment key={size.id}>{index > 0 && ' · '}{size.label === 'one' ? t('assets.uniform.oneSize') : <bdi dir="ltr">{size.label}</bdi>}</Fragment>)}</span></span></li>)}</ul> : <p className="text-sm text-muted-foreground">{t('assets.uniform.outNone')}</p>}</dd></div>
      </dl>
    </section>
    <section aria-label={t('assets.uniform.bySize')} className="overflow-hidden rounded-xl border border-border bg-surface">
      {mobile ? <div>{(['formal', 'guard', 'winter'] as const).map(group => {
        const rows = items.filter(item => item.group_key === group)
        return rows.length > 0 && <section key={group}><h2 className="px-4 pb-1 pt-4 text-sm font-semibold">{t(`assets.uniform.groups.${group}`)}</h2>{rows.map(item => <article key={item.id} className="border-t border-hairline p-4"><div className="flex items-center justify-between gap-2">{identify(item)}<div className="shrink-0 text-end"><span className="sr-only">{t('assets.uniform.inStock')}</span>{balance(item)}{actions(item)}</div></div><div className="mt-3">{detail(item)}</div></article>)}</section>
      })}</div> : <table className="w-full border-collapse text-start"><thead><tr className="text-xs font-normal text-muted-foreground"><th scope="col" className="w-[28%] px-5 py-3 text-start font-normal">{t('assets.uniform.piece')}</th><th scope="col" className="px-3 py-3 text-end font-normal">{t('assets.uniform.inStock')}</th><th scope="col" className="px-5 py-3 text-start font-normal">{t('assets.uniform.bySize')}</th><th scope="col" className="px-3"><span className="sr-only">{t('assets.uniform.action')}</span></th></tr></thead>
        {(['formal', 'guard', 'winter'] as const).map(group => {
          const rows = items.filter(item => item.group_key === group)
          return rows.length > 0 && <tbody key={group}><tr><th colSpan={4} scope="colgroup" className="px-5 pb-2 pt-4 text-start text-sm font-semibold">{t(`assets.uniform.groups.${group}`)}</th></tr>{rows.map(item => <tr key={item.id} className="border-t border-hairline"><td className="px-5 py-3">{identify(item)}</td><td className="px-3 py-3 text-end">{balance(item)}</td><td className="px-5 py-3">{detail(item)}</td><td className="px-3 py-3 text-end">{actions(item)}</td></tr>)}</tbody>
        })}
      </table>}
      {items.length === 0 && <p className="p-5 text-sm text-muted-foreground">{t('assets.uniform.noItems')}</p>}
    </section>
    {dialog?.kind === 'add' && <AddItemDialog open returnFocusRef={opener} onOpenChange={open => { if (!open) setDialog(null) }} />}
    {dialog?.kind === 'edit' && dialog.item && <ItemEditorDialog open item={dialog.item} returnFocusRef={opener} onSuccess={stockSaved} onOpenChange={open => { if (!open) setDialog(null) }} />}
    {dialog?.kind === 'receive' && <ReceiveStockDialog open returnFocusRef={opener} onSuccess={stockSaved} onOpenChange={open => { if (!open) setDialog(null) }} />}
    {dialog?.kind === 'history' && dialog.item && <StockHistory open item={dialog.item} returnFocusRef={opener} onOpenChange={open => { if (!open) setDialog(null) }} />}
  </>
}
