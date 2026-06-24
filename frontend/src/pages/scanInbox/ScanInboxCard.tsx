/**
 * ScanInboxCard — one triage card for a ScanInboxItem.
 *
 * Shows a headline appropriate to the item's state/tier, source-email
 * context (sender + subject), and action buttons:
 *  - Confirmed items   → Undo
 *  - Awaiting / unrouted / error → Confirm (when confidence tier allows) + Dismiss
 *  - Items with a ledger entry   → Open email (navigates to /ledger)
 *
 * Re-route pickers ("Pick employee" / "Pick a different record") are deferred
 * per the task brief — the Confirm/Dismiss/Undo path is the load-bearing flow.
 */

import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'

import { api, ApiError } from '@/lib/api'
import type { ScanInboxItem } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { Button } from '@/components/ui/button'

export function ScanInboxCard({ item }: { item: ScanInboxItem }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const empName =
    item.proposed_employee_name_en !== null
      ? pickEmployeeName(
          { name_en: item.proposed_employee_name_en, name_ar: item.proposed_employee_name_ar },
          i18n.language,
        )
      : ''

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['scan-inbox'] })

  const confirm = useMutation({
    mutationFn: () => api.confirmScanItem(item.id),
    onSuccess: () => {
      invalidate()
      toast.success(t('scanInbox.toast.filed'))
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : t('scanInbox.toast.error')),
  })

  const dismiss = useMutation({
    mutationFn: () => api.dismissScanItem(item.id),
    onSuccess: () => {
      invalidate()
      toast.success(t('scanInbox.toast.dismissed'))
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : t('scanInbox.toast.error')),
  })

  const undo = useMutation({
    mutationFn: () => api.undoScanItem(item.id),
    onSuccess: () => {
      invalidate()
      toast.success(t('scanInbox.toast.undone'))
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : t('scanInbox.toast.error')),
  })

  const headline = (() => {
    if (item.state === 'error') return t('scanInbox.errorRead')
    if (item.state === 'auto_filed') {
      return item.proposed_route === 'book_attach'
        ? t('scanInbox.autoFiledBook', { ref: item.proposed_ref })
        : t('scanInbox.autoFiledEmployee', { name: empName })
    }
    if (item.proposed_route === 'book_attach' && item.proposed_ref)
      return t('scanInbox.confirmBook', { ref: item.proposed_ref })
    if (item.proposed_route === 'employee_doc' && empName)
      return t('scanInbox.confirmEmployee', { type: item.document_type ?? '', name: empName })
    return t('scanInbox.manual')
  })()

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-[0.78em] text-muted-foreground" dir="auto">
        {item.email_sender
          ? t('scanInbox.fromEmail', { sender: item.email_sender })
          : item.filename}
      </div>
      {item.email_subject && (
        <div className="truncate text-[0.86em] font-medium text-foreground" dir="auto">
          {item.email_subject}
        </div>
      )}
      <p className="mt-2 text-[0.95em] text-foreground" dir="auto">
        {headline}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {item.state === 'auto_filed' ? (
          <Button variant="outline" size="sm" onClick={() => undo.mutate()} disabled={undo.isPending}>
            {t('scanInbox.actions.undo')}
          </Button>
        ) : (
          <>
            {item.confidence_tier !== 'manual' && item.state !== 'error' &&
              (item.proposed_route === 'book_attach' || item.proposed_route === 'employee_doc') && (
              <Button
                size="sm"
                onClick={() => confirm.mutate()}
                disabled={confirm.isPending}
              >
                {t('scanInbox.actions.confirm')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => dismiss.mutate()}
              disabled={dismiss.isPending}
            >
              {t('scanInbox.actions.dismiss')}
            </Button>
          </>
        )}
        {item.ledger_entry_id !== null && (
          <Button variant="ghost" size="sm" onClick={() => navigate('/ledger')}>
            {t('scanInbox.actions.openEmail')}
          </Button>
        )}
      </div>
    </div>
  )
}
