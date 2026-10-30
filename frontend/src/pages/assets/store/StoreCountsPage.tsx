import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, type StoreCountRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIsMobile } from '@/lib/useIsMobile'
import { StoreShell } from './StoreShell'
import { StoreQueryState } from './StoreQueryState'
import { formatNumber, formatQuantity, itemName, storeKeys } from './storeUtils'
import { ExpiryText } from './components/ExpiryText'

export function StoreCountsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const mobile = useIsMobile()
  const editable = useCapabilities().has('store.edit')
  const query = useQuery({ queryKey: storeKeys.counts, queryFn: api.listStoreCounts })
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const toggle = (id: number) => setExpanded((previous) => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const month = (count: StoreCountRead) => editable ? (
    <Link className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" to={`/assets/store/counts/${count.id}`}>
      <bdi dir="ltr" className="font-mono tabular-nums">{count.month}</bdi>
    </Link>
  ) : (
    <Button type="button" variant="ghost" className="min-h-11" aria-expanded={expanded.has(count.id)} aria-controls={`count-lines-${count.id}`} onClick={() => toggle(count.id)}>
      <bdi dir="ltr" className="font-mono tabular-nums">{count.month}</bdi>
      <span className="sr-only">{t('assets.store.counts.viewLines')}</span>
    </Button>
  )
  const lines = (count: StoreCountRead) => (
    <ul id={`count-lines-${count.id}`} className="divide-y divide-border rounded-lg border border-border bg-surface-raised px-3">
      {count.lines.map((line) => (
        <li key={line.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <bdi dir="ltr" className="font-mono tabular-nums text-muted-foreground">{line.item_code}</bdi>
            <span dir="auto">{itemName(line, i18n.language)}</span>
            <ExpiryText batch={line} />
          </div>
          <bdi dir="auto" className="whitespace-nowrap tabular-nums">{formatQuantity(line.quantity, line, i18n.language)}</bdi>
        </li>
      ))}
      {count.lines.length === 0 && <li className="py-3 text-sm text-muted-foreground">{t('assets.store.counts.noLines')}</li>}
    </ul>
  )

  return (
    <StoreShell title={t('assets.store.counts.title')} description={t('assets.store.counts.description')} actions={editable && (
      <Link className={buttonVariants({ className: 'min-h-11' })} to="/assets/store/counts/new"><Plus aria-hidden className="h-4 w-4" />{t('assets.store.counts.new')}</Link>
    )}>
      <StoreQueryState isPending={query.isPending} error={query.error} onRetry={() => { void query.refetch() }} isEmpty={query.data?.length === 0} emptyIcon={ClipboardList} emptyMessage={t('assets.store.counts.empty')} emptyDescription={t('assets.store.counts.emptyDescription')}>
        {mobile ? (
          <div className="flex flex-col gap-3">{query.data?.map((count) => (
            <article key={count.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">{month(count)}<span className="text-sm text-muted-foreground">{t('assets.store.counts.lineTotal', { total: formatNumber(count.lines.length, i18n.language) })}</span></div>
              <p className="text-sm"><span className="text-muted-foreground">{t('assets.store.counts.countedOn')}: </span><bdi dir="ltr" className="font-mono tabular-nums">{count.counted_on}</bdi></p>
              <p dir="auto" className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{count.note || t('assets.store.counts.noNote')}</p>
              {!editable && expanded.has(count.id) && <div className="mt-3">{lines(count)}</div>}
            </article>
          ))}</div>
        ) : (
          <Table><TableHeader><TableRow className="hover:bg-surface-raised motion-reduce:transition-none"><TableHead>{t('assets.store.counts.month')}</TableHead><TableHead>{t('assets.store.counts.countedOn')}</TableHead><TableHead>{t('assets.store.counts.lines')}</TableHead><TableHead>{t('assets.store.counts.note')}</TableHead></TableRow></TableHeader>
            <TableBody>{query.data?.map((count) => (
              <Fragment key={count.id}>
                <TableRow className="hover:bg-surface-tinted motion-reduce:transition-none"><TableCell>{month(count)}</TableCell><TableCell><bdi dir="ltr" className="font-mono tabular-nums">{count.counted_on}</bdi></TableCell><TableCell><bdi dir="ltr" className="font-mono tabular-nums">{formatNumber(count.lines.length, i18n.language)}</bdi></TableCell><TableCell className="max-w-md whitespace-pre-wrap"><span dir="auto">{count.note || t('assets.store.counts.noNote')}</span></TableCell></TableRow>
                {!editable && expanded.has(count.id) && <TableRow className="hover:bg-surface motion-reduce:transition-none"><TableCell colSpan={4}>{lines(count)}</TableCell></TableRow>}
              </Fragment>
            ))}</TableBody>
          </Table>
        )}
      </StoreQueryState>
    </StoreShell>
  )
}
