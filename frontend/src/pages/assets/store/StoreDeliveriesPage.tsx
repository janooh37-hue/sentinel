import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FileText, Plus, Trash2, Truck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DocumentViewerDialog } from '@/components/ui/document-viewer-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader } from '@/components/ui/table'
import { api, type StoreDeliveryNoteFile, type StoreDeliveryRead } from '@/lib/api'
import { toast } from '@/lib/toast'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIsMobile } from '@/lib/useIsMobile'
import { DeliveryDialog } from './components/DeliveryDialog'
import { StoreQueryState } from './StoreQueryState'
import { StoreShell } from './StoreShell'
import { invalidateStoreQueries, storeErrorMessage, storeKeys } from './storeUtils'
import { ExpiryText } from './components/ExpiryText'
import { ItemIdentity, StoreQuantity } from './components/RecordParts'

export function StoreDeliveriesPage(): React.JSX.Element {
  const { t } = useTranslation()
  const mobile = useIsMobile()
  const editable = useCapabilities().has('store.edit')
  const qc = useQueryClient()
  const query = useQuery({ queryKey: storeKeys.deliveries, queryFn: api.listStoreDeliveries })
  const [dialog, setDialog] = useState(false)
  const [deleting, setDeleting] = useState<StoreDeliveryRead | null>(null)
  const [viewer, setViewer] = useState<StoreDeliveryNoteFile | null>(null)
  const [uploadWarning, setUploadWarning] = useState<string | null>(null)
  const deleteFocus = useRef<HTMLButtonElement | null>(null)
  const mutation = useMutation({
    mutationFn: (id: number) => api.deleteStoreDelivery(id),
    onSuccess: () => {
      invalidateStoreQueries(qc)
      toast.success(t('assets.store.deliveries.deleted'))
    },
    onError: (error) => toast.error(storeErrorMessage(error, t)),
  })
  const deliveries = [...(query.data ?? [])].sort((a, b) => b.received_on.localeCompare(a.received_on) || b.id - a.id)

  function attachment(file: StoreDeliveryNoteFile | null): React.ReactNode {
    if (!file) return <span className="text-muted-foreground">{t('assets.store.deliveries.noAttachment')}</span>
    return (
      <button type="button" onClick={() => setViewer(file)} aria-label={t('assets.store.deliveries.viewNote', { name: file.name })} className="flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-border p-2 text-start text-sm text-primary transition-colors hover:bg-surface-tinted motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {file.media_type.startsWith('image/') ? <img src={file.url} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded object-cover" /> : <FileText aria-hidden className="h-5 w-5 shrink-0" />}
        <span dir="auto" className="min-w-0 break-words">{file.name}</span>
      </button>
    )
  }

  function deleteButton(delivery: StoreDeliveryRead): React.ReactNode {
    if (!editable) return null
    return <Button type="button" variant="ghost" className="min-h-11 text-accent" disabled={mutation.isPending} aria-label={t('assets.store.deliveries.deleteDelivery', { date: delivery.received_on })} onClick={(event) => { deleteFocus.current = event.currentTarget; setDeleting(delivery) }}><Trash2 aria-hidden className="h-4 w-4" />{t('assets.store.deliveries.delete')}</Button>
  }

  return (
    <StoreShell title={t('assets.store.deliveries.title')} description={t('assets.store.deliveries.description')} actions={editable && <Button type="button" className="min-h-11" onClick={() => setDialog(true)}><Plus aria-hidden className="h-4 w-4" />{t('assets.store.deliveries.log')}</Button>}>
      {uploadWarning && <p role="alert" className="rounded-lg border border-warning bg-warning-soft p-3 text-sm text-foreground" dir="auto">{uploadWarning}</p>}
      <StoreQueryState isPending={query.isPending} error={query.error} onRetry={() => void query.refetch()} isEmpty={deliveries.length === 0} emptyIcon={Truck} emptyMessage={t('assets.store.deliveries.empty')} emptyDescription={t(editable ? 'assets.store.deliveries.emptyDescription' : 'assets.store.deliveries.emptyReadOnly')}>
        {mobile ? (
          <div className="flex flex-col gap-3">
            {deliveries.map((delivery) => (
              <article key={delivery.id} className="min-w-0 rounded-xl border border-border bg-surface p-4">
                <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold"><span className="sr-only">{t('assets.store.deliveries.receivedOn')}: </span><bdi dir="ltr" className="font-mono tabular-nums">{delivery.received_on}</bdi></h2>
                  {deleteButton(delivery)}
                </header>
                <p className="mb-3 whitespace-pre-wrap text-sm text-muted-foreground" dir="auto">{delivery.note || t('assets.store.deliveries.noNote')}</p>
                <ul className="mb-3 divide-y divide-border">
                  {delivery.lines.map((line) => (
                    <li key={line.id} className="flex flex-col gap-1 py-3 text-sm">
                      <ItemIdentity row={line} />
                      <div className="flex flex-wrap justify-between gap-2"><span>{t('assets.store.deliveries.expiry')}: <ExpiryText batch={line} /></span><StoreQuantity value={line.quantity} item={line} /></div>
                    </li>
                  ))}
                </ul>
                {attachment(delivery.note_file)}
              </article>
            ))}
          </div>
        ) : (
          <Table>
            <caption className="sr-only">{t('assets.store.deliveries.title')}</caption>
            <TableHeader><tr><TableHead>{t('assets.store.deliveries.receivedOn')}</TableHead><TableHead>{t('assets.store.deliveries.note')}</TableHead><TableHead>{t('assets.store.deliveries.lines')}</TableHead><TableHead>{t('assets.store.deliveries.deliveryNoteColumn')}</TableHead>{editable && <TableHead>{t('assets.store.deliveries.actions')}</TableHead>}</tr></TableHeader>
            <TableBody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <TableCell className="align-top"><bdi dir="ltr" className="whitespace-nowrap font-mono tabular-nums">{delivery.received_on}</bdi></TableCell>
                  <TableCell className="max-w-64 whitespace-pre-wrap break-words align-top"><span dir="auto">{delivery.note || t('assets.store.deliveries.noNote')}</span></TableCell>
                  <TableCell className="align-top">
                    <ul className="divide-y divide-border">
                      {delivery.lines.map((line) => <li key={line.id} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0"><ItemIdentity row={line} /><div className="flex flex-wrap gap-x-4 gap-y-1 text-sm"><span>{t('assets.store.deliveries.expiry')}: <ExpiryText batch={line} /></span><StoreQuantity value={line.quantity} item={line} /></div></li>)}
                    </ul>
                  </TableCell>
                  <TableCell className="max-w-64 align-top">{attachment(delivery.note_file)}</TableCell>
                  {editable && <TableCell className="align-top">{deleteButton(delivery)}</TableCell>}
                </tr>
              ))}
            </TableBody>
          </Table>
        )}
      </StoreQueryState>
      {editable && <DeliveryDialog open={dialog} onOpenChange={setDialog} onSaved={setUploadWarning} />}
      <ConfirmDialog open={!!deleting && editable} onOpenChange={(open) => { if (!open) setDeleting(null) }} title={t('assets.store.deliveries.deleteTitle')} description={t('assets.store.deliveries.deleteDescription')} confirmLabel={t('assets.store.deliveries.delete')} returnFocusRef={deleteFocus} destructive onConfirm={() => { if (deleting && editable) mutation.mutate(deleting.id) }} />
      {viewer && <DocumentViewerDialog items={[{ name: viewer.name, kind: viewer.media_type === 'application/pdf' ? 'pdf' : 'image', imageUrl: viewer.media_type.startsWith('image/') ? viewer.url : undefined, pdfBase64Url: viewer.media_type === 'application/pdf' ? `${viewer.url}?encoding=base64` : undefined, openUrl: viewer.url, downloadUrl: viewer.url }]} onClose={() => setViewer(null)} />}
    </StoreShell>
  )
}
