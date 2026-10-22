/**
 * SendReportDialog — «Sign and send to manager». Files the report as a General
 * Book (6/1) whose «Prepared by» carries the caller's saved signature, and
 * submits it to the picked manager; the manager's approval signs it at the
 * General Book's own manager-signature slot.
 *
 * No saved signature → the dialog says so and links to Settings; nothing is
 * filed with a blank signature (the server refuses too).
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/lib/toast'

import { api, apiErrorMessage } from '@/lib/api'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'

import { FIELD_LABEL, NATIVE_SELECT } from './controls'

interface SendReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  subject: string
  /** The paper's scope lines, shown so the sender sees what is filed. */
  scope: string[]
  /** Built on send, so the body is the report as it stands then. */
  buildBody: () => string
}

export function SendReportDialog({ open, onOpenChange, ...rest }: SendReportDialogProps): React.JSX.Element {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      {open && <Body {...rest} close={() => onOpenChange(false)} />}
    </DialogRoot>
  )
}

function Body({
  subject,
  scope,
  buildBody,
  close,
}: Omit<SendReportDialogProps, 'open' | 'onOpenChange'> & { close: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [picked, setPicked] = useState<string | null>(null)

  const signature = useQuery({ queryKey: ['signatures', 'me'], queryFn: () => api.getSavedSignature() })
  const approvers = useQuery({
    queryKey: ['books', 'approvers'],
    queryFn: () => api.listApprovers(),
    staleTime: 5 * 60_000,
  })
  // The admin-designated default manager preselects until the sender picks.
  const approverId = picked ?? String(approvers.data?.find((a) => a.is_default)?.id ?? '')

  const send = useMutation({
    mutationFn: () =>
      api.sendLeaveReport({ subject, body_html: buildBody(), approver_user_id: Number(approverId) }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(t('leaves.report.sendDone', { ref: res.ref }))
      close()
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const ready = !!signature.data && approverId !== '' && !send.isPending

  return (
    <DialogContent>
      <DialogHeader className="pe-12">
        <DialogTitle>{t('leaves.report.sendTitle')}</DialogTitle>
        {/* The filed book (subject and body) is Arabic whatever the UI language. */}
        <DialogDescription dir="rtl" className="text-start">
          {subject}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-5 overflow-y-auto px-4 py-4">
        {scope.length > 0 && (
          <div>
            <p className={FIELD_LABEL}>{t('leaves.report.sendScope')}</p>
            <ul className="list-disc ps-5 text-[0.84em] text-foreground">
              {scope.map((s) => (
                <li key={s}>
                  <bdi>{s}</bdi>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className={FIELD_LABEL}>{t('leaves.report.preparedBy')}</p>
          {signature.isPending ? (
            <div className="h-12 w-40 animate-pulse rounded-lg bg-surface-tinted" />
          ) : signature.data ? (
            <img
              src={signature.data}
              alt={t('leaves.report.sigSignature')}
              className="h-12 w-auto rounded-lg border border-hairline bg-white p-1"
            />
          ) : (
            <div className="rounded-lg border border-warning/40 bg-warning-soft/50 px-3 py-2 text-[0.84em] text-foreground">
              {t('leaves.report.sendNoSignature')}{' '}
              <button
                type="button"
                onClick={() => {
                  close()
                  navigate('/settings')
                }}
                className="rounded text-primary underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('leaves.report.sendAddSignature')}
              </button>
            </div>
          )}
        </div>

        <div>
          <label htmlFor="send-report-manager" className={FIELD_LABEL}>
            {t('books.approval.signingManager')}
          </label>
          {approvers.isPending ? (
            <div className="h-9 w-full animate-pulse rounded-lg bg-surface-tinted" />
          ) : (approvers.data ?? []).length === 0 ? (
            <p className="text-[0.84em] text-muted-foreground">{t('books.approval.noApproversBody')}</p>
          ) : (
            <select
              id="send-report-manager"
              value={approverId}
              onChange={(e) => setPicked(e.target.value)}
              className={`${NATIVE_SELECT} w-full`}
            >
              <option value="">{t('books.approval.selectApprover')}</option>
              {(approvers.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2.5 border-t border-hairline px-4 py-3">
        <button
          type="button"
          onClick={close}
          className="min-h-10 rounded-lg border border-hairline px-4 py-2 text-[0.84em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          aria-disabled={!ready ? true : undefined}
          aria-busy={send.isPending ? true : undefined}
          onClick={() => {
            if (ready) send.mutate()
          }}
          className="min-h-10 rounded-lg bg-primary px-4 py-2 text-[0.84em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-40"
        >
          {t('leaves.report.sendConfirm')}
        </button>
      </footer>
    </DialogContent>
  )
}
