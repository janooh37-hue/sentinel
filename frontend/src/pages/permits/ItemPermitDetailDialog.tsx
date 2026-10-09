/**
 * ItemPermitDetailDialog — read + manage surface for one item-entry permit:
 * facts, the items table, document versions of the generated 1/5 letter, and
 * (by capability) edit, send for approval and delete.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import { toast } from 'sonner'

import { api, apiErrorMessage, ApiError, type ItemPermitRead } from '@/lib/api'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useCapabilities } from '@/lib/useCapabilities'
import { PermitDocumentVersions } from './PermitDocumentVersions'
import { approvalTone, fmtDate, zoneTone, type PermitApprovalState } from './permitUtils'

interface Props {
  permitId: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (permit: ItemPermitRead) => void
  onNotFound: () => void
}

export function ItemPermitDetailDialog({
  permitId,
  open,
  onOpenChange,
  onEdit,
  onNotFound,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const { has } = useCapabilities()
  const canEdit = has('permits.edit')
  const canDelete = has('permits.delete')
  const [deleteOpen, setDeleteOpen] = useState(false)

  const query = useQuery({
    queryKey: ['item-permit', permitId],
    queryFn: () => api.getItemPermit(permitId),
    enabled: open,
  })
  const permit = query.data
  useEffect(() => {
    const missing =
      (query.isSuccess && !query.data) ||
      (query.error instanceof ApiError && query.error.status === 404)
    if (missing) onNotFound()
  }, [onNotFound, query.data, query.error, query.isSuccess])

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['item-permit', permitId] })
    void qc.invalidateQueries({ queryKey: ['item-permits-list'] })
    void qc.invalidateQueries({ queryKey: ['books', 'permit'] })
  }

  const submitApproval = useMutation({
    mutationFn: () => api.submitItemPermitApproval(permitId),
    onSuccess: () => {
      invalidate()
      toast.success(t('permits.approval.sentToast'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const del = useMutation({
    mutationFn: () => api.deleteItemPermit(permitId),
    onSuccess: () => {
      invalidate()
      onOpenChange(false)
      toast.success(t('common.savedToast'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const approvalState = (permit?.approval_state ?? 'none') as PermitApprovalState
  // Only a letter that isn't already in the loop can be (re-)sent.
  const canSend =
    canEdit && Boolean(permit?.book_id) && ['none', 'rejected', 'returned'].includes(approvalState)

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {permit
              ? t('permits.items.detail.title', { ref: permit.book_ref ?? `#${permit.id}` })
              : t('common.loading')}
          </DialogTitle>
          {permit && (
            <DialogDescription>
              {t('permits.items.detail.createdAt', { date: fmtDate(permit.created_at) })}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4 text-sm">
          {query.isError && <p className="text-destructive">{t('permits.items.loadError')}</p>}
          {permit && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {permit.zones.map((z) => (
                  <Badge key={z} tone={zoneTone(z)}>
                    {t(`permits.zone.${z}`)}
                  </Badge>
                ))}
                {permit.book_id && (
                  <Badge tone={approvalTone(approvalState)}>
                    {t(`permits.approval.${approvalState}`)}
                  </Badge>
                )}
              </div>

              <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                {permit.book_ref && (
                  <Fact label={t('permits.items.detail.ref')} value={permit.book_ref} mono ltr />
                )}
                <Fact label={t('permits.items.detail.recipient')} value={permit.recipient} />
                <Fact
                  label={t('permits.items.detail.zone')}
                  value={permit.zones
                    .map((z) => t(`permits.zone.${z}`))
                    .join(i18n.language.startsWith('ar') ? '، ' : ', ')}
                />
                <Fact label={t('permits.items.detail.site')} value={permit.site} />
                <Fact label={t('permits.items.detail.employeeNo')} value={permit.employee_id} mono ltr />
                <Fact label={t('permits.items.detail.name')} value={permit.employee_name} />
                {permit.employee_title && (
                  <Fact label={t('permits.items.detail.jobTitle')} value={permit.employee_title} />
                )}
              </dl>

              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground rtl:tracking-normal">
                  {t('permits.items.detail.items')}
                </h3>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-tinted text-xs text-muted-foreground">
                      <tr>
                        <th className="w-12 px-3 py-2 text-start font-medium">
                          {t('permits.items.detail.no')}
                        </th>
                        <th className="px-3 py-2 text-start font-medium">
                          {t('permits.items.detail.item')}
                        </th>
                        <th className="w-20 px-3 py-2 text-end font-medium">
                          {t('permits.items.detail.quantity')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {permit.items.map((item, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                          <td className="px-3 py-2" dir="auto">
                            {item.name}
                          </td>
                          <td className="px-3 py-2 text-end tabular-nums">{item.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {permit.book_id != null && <PermitDocumentVersions bookId={permit.book_id} />}
            </>
          )}
        </div>

        {permit && (canDelete || canEdit) && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
            {canDelete && (
              <Button
                type="button"
                variant="ghost"
                className="me-auto text-destructive hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                {t('permits.actions.delete')}
              </Button>
            )}
            {canSend && (
              <Button
                type="button"
                disabled={submitApproval.isPending}
                onClick={() => submitApproval.mutate()}
              >
                <Send className="me-1.5 h-4 w-4" aria-hidden />
                {t('permits.detail.sendForApproval')}
              </Button>
            )}
            {canEdit && (
              <Button type="button" variant="outline" onClick={() => onEdit(permit)}>
                {t('permits.actions.edit')}
              </Button>
            )}
          </div>
        )}

        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t('permits.items.delete.title')}
          description={t('permits.items.delete.help')}
          confirmLabel={t('permits.delete.confirm')}
          destructive
          onConfirm={() => del.mutate()}
        />
      </DialogContent>
    </DialogRoot>
  )
}

function Fact({
  label,
  value,
  mono = false,
  ltr = false,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
  ltr?: boolean
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-foreground ${mono ? 'font-mono' : ''}`} dir={ltr ? 'ltr' : 'auto'}>
        {value}
      </dd>
    </div>
  )
}
