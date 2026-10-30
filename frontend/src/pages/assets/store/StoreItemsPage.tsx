import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Boxes, Pencil, Plus, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, type StoreItemRead } from '@/lib/api'
import { toast } from '@/lib/toast'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIsMobile } from '@/lib/useIsMobile'
import { StoreItemDialog } from './components/StoreItemDialog'
import { StoreQueryState } from './StoreQueryState'
import { StoreShell } from './StoreShell'
import { categoryName, countingUnit, formatContains, formatQuantity, invalidateStoreQueries, isArabic, itemName, storeErrorMessage, storeKeys } from './storeUtils'

export function StoreItemsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const mobile = useIsMobile()
  const editable = useCapabilities().has('store.edit')
  const qc = useQueryClient()
  const [includeArchived, setIncludeArchived] = useState(false)
  const [dialog, setDialog] = useState<{ item: StoreItemRead | null } | null>(null)
  const [archiveItem, setArchiveItem] = useState<StoreItemRead | null>(null)
  const archiveTrigger = useRef<HTMLButtonElement | null>(null)
  const query = useQuery({ queryKey: storeKeys.items(includeArchived), queryFn: () => api.listStoreItems(includeArchived) })
  const mutation = useMutation({
    mutationFn: ({ item, restore }: { item: StoreItemRead; restore: boolean }) => restore ? api.restoreStoreItem(item.id) : api.archiveStoreItem(item.id),
    onSuccess: (_, { restore }) => {
      invalidateStoreQueries(qc)
      toast.success(t(restore ? 'assets.store.items.restored' : 'assets.store.items.archivedSuccess'))
    },
    onError: (err) => toast.error(storeErrorMessage(err, t)),
  })
  const actions = (item: StoreItemRead) => editable && <div className="flex flex-wrap items-center justify-end gap-1">
    <Button type="button" variant="ghost" className="min-h-11 motion-reduce:transition-none" onClick={() => setDialog({ item })} aria-label={t('assets.store.items.editItem', { name: itemName(item, i18n.language) })}>
      <Pencil aria-hidden className="h-4 w-4" />{t('assets.store.items.edit')}
    </Button>
    {item.archived_at ? <Button type="button" variant="ghost" className="min-h-11 motion-reduce:transition-none" disabled={mutation.isPending}
      onClick={() => mutation.mutate({ item, restore: true })} aria-label={t('assets.store.items.restoreItem', { name: itemName(item, i18n.language) })}>
      <RotateCcw aria-hidden className="h-4 w-4" />{t('assets.store.items.restore')}
    </Button> : <Button type="button" variant="ghost" className="min-h-11 motion-reduce:transition-none" disabled={mutation.isPending}
      onClick={(event) => { archiveTrigger.current = event.currentTarget; setArchiveItem(item) }} aria-label={t('assets.store.items.archiveItem', { name: itemName(item, i18n.language) })}>
      <Archive aria-hidden className="h-4 w-4" />{t('assets.store.items.archive')}
    </Button>}
  </div>
  const name = (item: StoreItemRead) => <div className="flex flex-col gap-1">
    <span dir="auto" lang={isArabic(i18n.language) && item.name_ar ? 'ar' : 'en'} className="font-medium">{itemName(item, i18n.language)}</span>
    {item.name_ar && <span dir="auto" lang={isArabic(i18n.language) ? 'en' : 'ar'} className="text-sm text-muted-foreground">{isArabic(i18n.language) ? item.name_en : item.name_ar}</span>}
    {item.archived_at && <span className="text-xs font-semibold text-muted-foreground">{t('assets.store.items.archived')}</span>}
  </div>
  const stock = (item: StoreItemRead) => <div className="flex flex-col gap-1">
    <bdi dir="auto" className="whitespace-nowrap tabular-nums">{formatQuantity(item.on_hand, item, i18n.language)}</bdi>
    {item.minimum_level != null && item.on_hand < item.minimum_level && <span className="text-xs font-semibold text-warning">{t('assets.store.items.lowStock')}</span>}
  </div>
  const unit = (item: StoreItemRead) => <div className="flex flex-col gap-1">
    <span dir="auto">{countingUnit(item, i18n.language)}</span>
    {formatContains(item, i18n.language) && <bdi dir="auto" className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{formatContains(item, i18n.language)}</bdi>}
  </div>
  return (
    <StoreShell title={t('assets.store.items.title')} description={t('assets.store.items.description')}
      actions={editable && <Button className="min-h-11 motion-reduce:transition-none" onClick={() => setDialog({ item: null })}><Plus aria-hidden className="h-4 w-4" />{t('assets.store.items.add')}</Button>}>
      <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} className="h-4 w-4 accent-primary" />
        {t('assets.store.items.showArchived')}
      </label>
      <StoreQueryState isPending={query.isPending} error={query.error} onRetry={() => void query.refetch()} isEmpty={!query.data?.length}
        emptyIcon={Boxes} emptyMessage={t('assets.store.items.empty')} emptyDescription={t(editable ? 'assets.store.items.emptyDescription' : 'assets.store.items.emptyReadOnly')}>
        {mobile ? <div className="flex flex-col gap-3">{query.data?.map((item) => <article key={item.id} className="rounded-xl border border-border bg-surface p-4">
          <header className="flex flex-wrap items-start justify-between gap-3">{name(item)}<bdi dir="ltr" className="font-mono text-sm tabular-nums text-muted-foreground">{item.code}</bdi></header>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="mb-1 text-xs text-muted-foreground">{t('assets.store.items.category')}</dt><dd dir="auto">{categoryName(item.category, i18n.language)}</dd></div>
            <div><dt className="mb-1 text-xs text-muted-foreground">{t('assets.store.items.countingUnit')}</dt><dd>{unit(item)}</dd></div>
            <div><dt className="mb-1 text-xs text-muted-foreground">{t('assets.store.items.onHand')}</dt><dd>{stock(item)}</dd></div>
            <div><dt className="mb-1 text-xs text-muted-foreground">{t('assets.store.items.minimum')}</dt><dd><bdi dir="auto" className="whitespace-nowrap tabular-nums">{item.minimum_level == null ? '—' : formatQuantity(item.minimum_level, item, i18n.language)}</bdi></dd></div>
          </dl>
          {editable && <div className="mt-3 border-t border-border pt-2">{actions(item)}</div>}
        </article>)}</div> : <Table>
          <TableHeader><TableRow className="hover:bg-transparent motion-reduce:transition-none">
            {['code', 'name', 'category', 'countingUnit', 'onHand', 'minimum'].map((key) => <TableHead key={key}>{t(`assets.store.items.${key}`)}</TableHead>)}
            {editable && <TableHead className="text-end">{t('assets.store.items.actions')}</TableHead>}
          </TableRow></TableHeader>
          <TableBody>{query.data?.map((item) => <TableRow key={item.id} className="hover:bg-surface-tinted motion-reduce:transition-none">
            <TableCell><bdi dir="ltr" className="font-mono tabular-nums">{item.code}</bdi></TableCell>
            <TableCell>{name(item)}</TableCell><TableCell><span dir="auto">{categoryName(item.category, i18n.language)}</span></TableCell>
            <TableCell>{unit(item)}</TableCell><TableCell>{stock(item)}</TableCell>
            <TableCell><bdi dir="auto" className="whitespace-nowrap tabular-nums">{item.minimum_level == null ? '—' : formatQuantity(item.minimum_level, item, i18n.language)}</bdi></TableCell>
            {editable && <TableCell>{actions(item)}</TableCell>}
          </TableRow>)}</TableBody>
        </Table>}
      </StoreQueryState>
      {editable && dialog && <StoreItemDialog open onOpenChange={(open) => { if (!open) setDialog(null) }} item={dialog.item} />}
      {editable && <ConfirmDialog open={archiveItem != null} onOpenChange={(open) => { if (!open) setArchiveItem(null) }}
        title={t('assets.store.items.archiveTitle')} description={t('assets.store.items.archiveDescription', { name: archiveItem ? itemName(archiveItem, i18n.language) : '' })}
        confirmLabel={t('assets.store.items.archive')} returnFocusRef={archiveTrigger}
        onConfirm={() => { if (archiveItem) mutation.mutate({ item: archiveItem, restore: false }) }} />}
    </StoreShell>
  )
}
