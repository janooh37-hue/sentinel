import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'

import { FormAlert } from '@/components/forms/DialogShell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, type StoreDisposalRead } from '@/lib/api'
import { toast } from '@/lib/toast'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIsMobile } from '@/lib/useIsMobile'

import { DisposalDialog } from './components/DisposalDialog'
import { StoreQueryState } from './StoreQueryState'
import { StoreShell } from './StoreShell'
import { formatQuantity, invalidateStoreQueries, itemName, storeErrorMessage, storeKeys } from './storeUtils'
import { ExpiryText } from './components/ExpiryText'

export function StoreDisposalsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const mobile = useIsMobile()
  const { has } = useCapabilities()
  const editable = has('store.edit')
  const queryClient = useQueryClient()
  const [recordOpen, setRecordOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<StoreDisposalRead | null>(null)
  const deleteTrigger = useRef<HTMLElement | null>(null)
  const disposalsQuery = useQuery({ queryKey: storeKeys.disposals, queryFn: () => api.listStoreDisposals() })
  const disposals = useMemo(() => [...(disposalsQuery.data ?? [])].sort((a, b) => b.disposed_on.localeCompare(a.disposed_on) || b.id - a.id), [disposalsQuery.data])
  const deletion = useMutation({
    mutationFn: (id: number) => api.deleteStoreDisposal(id),
    onSuccess: () => {
      invalidateStoreQueries(queryClient)
      toast.success(t('assets.store.disposals.deleted'))
    },
    onError: (error) => toast.error(storeErrorMessage(error, t)),
  })

  return (
    <StoreShell title={t('assets.store.disposals.title')} description={t('assets.store.disposals.description')} actions={editable ? (
      <Button type="button" className="min-h-11" onClick={() => setRecordOpen(true)}><Plus aria-hidden className="h-4 w-4" />{t('assets.store.disposals.record')}</Button>
    ) : undefined}>
      <FormAlert id="store-disposal-delete-error" message={deletion.error ? storeErrorMessage(deletion.error, t) : null} />
      <StoreQueryState isPending={disposalsQuery.isPending} error={disposalsQuery.error} onRetry={() => { void disposalsQuery.refetch() }} isEmpty={disposals.length === 0} emptyIcon={Trash2} emptyMessage={t('assets.store.disposals.empty')} emptyDescription={t(editable ? 'assets.store.disposals.emptyDescription' : 'assets.store.disposals.emptyReadOnly')}>
        {mobile ? (
          <ul className="flex flex-col gap-3" aria-label={t('assets.store.disposals.title')}>
            {disposals.map((row) => (
              <li key={row.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <bdi dir="ltr" className="font-mono text-xs tabular-nums text-muted-foreground">{row.item_code}</bdi>
                    <span dir="auto" className="font-medium">{itemName(row, i18n.language)}</span>
                  </div>
                  <Badge className="border border-border bg-surface-tinted text-foreground">{t(`assets.store.disposals.reasons.${row.reason}`)}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-xs text-muted-foreground">{t('assets.store.disposals.disposedOn')}</dt><dd><bdi dir="ltr" className="font-mono tabular-nums">{row.disposed_on}</bdi></dd></div>
                  <div><dt className="text-xs text-muted-foreground">{t('assets.store.disposals.expiry')}</dt><dd><ExpiryText batch={row} /></dd></div>
                  <div className="col-span-2"><dt className="text-xs text-muted-foreground">{t('assets.store.disposals.quantity')}</dt><dd><bdi dir="auto" className="whitespace-nowrap tabular-nums">{formatQuantity(row.quantity, row, i18n.language)}</bdi></dd></div>
                  <div className="col-span-2"><dt className="text-xs text-muted-foreground">{t('assets.store.disposals.note')}</dt><dd dir="auto" className="whitespace-pre-wrap break-words">{row.note || '—'}</dd></div>
                </dl>
                {editable && (
                  <div className="mt-3 flex justify-end border-t border-hairline pt-2">
                    <Button type="button" variant="ghost" className="min-h-11 text-destructive" disabled={deletion.isPending} aria-label={t('assets.store.disposals.deleteAria', { code: row.item_code, date: row.disposed_on })} onClick={(event) => {
                      deleteTrigger.current = event.currentTarget
                      deletion.reset()
                      setDeleteTarget(row)
                    }}>
                      <Trash2 aria-hidden className="h-4 w-4" />{t('assets.store.disposals.delete')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Table aria-label={t('assets.store.disposals.title')}>
            <TableHeader><TableRow className="hover:bg-surface-raised motion-reduce:transition-none">
              <TableHead scope="col">{t('assets.store.disposals.disposedOn')}</TableHead>
              <TableHead scope="col">{t('assets.store.disposals.item')}</TableHead>
              <TableHead scope="col">{t('assets.store.disposals.expiry')}</TableHead>
              <TableHead scope="col">{t('assets.store.disposals.quantity')}</TableHead>
              <TableHead scope="col">{t('assets.store.disposals.reason')}</TableHead>
              <TableHead scope="col">{t('assets.store.disposals.note')}</TableHead>
              {editable && <TableHead scope="col"><span className="sr-only">{t('assets.store.disposals.actions')}</span></TableHead>}
            </TableRow></TableHeader>
            <TableBody>{disposals.map((row) => (
              <TableRow key={row.id} className="hover:bg-surface-tinted motion-reduce:transition-none">
                <TableCell><bdi dir="ltr" className="whitespace-nowrap font-mono tabular-nums">{row.disposed_on}</bdi></TableCell>
                <TableCell>
                  <div className="flex min-w-0 flex-col gap-1">
                    <bdi dir="ltr" className="font-mono text-xs tabular-nums text-muted-foreground">{row.item_code}</bdi>
                    <span dir="auto" className="font-medium">{itemName(row, i18n.language)}</span>
                  </div>
                </TableCell>
                <TableCell><ExpiryText batch={row} /></TableCell>
                <TableCell><bdi dir="auto" className="whitespace-nowrap tabular-nums">{formatQuantity(row.quantity, row, i18n.language)}</bdi></TableCell>
                <TableCell><Badge className="border border-border bg-surface-tinted text-foreground">{t(`assets.store.disposals.reasons.${row.reason}`)}</Badge></TableCell>
                <TableCell className="max-w-xs whitespace-pre-wrap break-words" dir="auto">{row.note || '—'}</TableCell>
                {editable && (
                  <TableCell className="text-end">
                    <Button type="button" variant="ghost" className="min-h-11 text-destructive" disabled={deletion.isPending} aria-label={t('assets.store.disposals.deleteAria', { code: row.item_code, date: row.disposed_on })} onClick={(event) => {
                      deleteTrigger.current = event.currentTarget
                      deletion.reset()
                      setDeleteTarget(row)
                    }}>
                      <Trash2 aria-hidden className="h-4 w-4" />{t('assets.store.disposals.delete')}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </StoreQueryState>
      {editable && recordOpen && <DisposalDialog open={recordOpen} onOpenChange={setRecordOpen} />}
      {editable && (
        <ConfirmDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
          title={t('assets.store.disposals.deleteTitle')}
          description={<Trans i18nKey="assets.store.disposals.deleteDescription" values={{ code: deleteTarget?.item_code, date: deleteTarget?.disposed_on }} components={{ code: <bdi dir="ltr" className="font-mono tabular-nums" />, date: <bdi dir="ltr" className="font-mono tabular-nums" /> }} />}
          confirmLabel={t('assets.store.disposals.delete')}
          destructive
          returnFocusRef={deleteTrigger}
          onConfirm={() => { if (deleteTarget) deletion.mutate(deleteTarget.id) }}
        />
      )}
    </StoreShell>
  )
}
