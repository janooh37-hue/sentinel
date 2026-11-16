import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { ForwardToBranchDialog } from '@/components/books/ForwardToBranchDialog'
import { useBookApprovalActions } from '@/components/books/useBookApprovalActions'
import { approverStep, isApproverAssignee } from '@/components/books/reviewers'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api, type ApprovalLogItem } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { bidi } from '@/lib/bidi'
import { useCapabilities } from '@/lib/useCapabilities'
import { DecisionReasonForm } from './DecisionReasonForm'
import { RecordDecisionActions } from './RecordDecisionActions'

/** The log item is not an authorization snapshot: fetch its exact revision. */
export function ApprovalPreviewActions({ item, onClose }: { item: ApprovalLogItem; onClose: () => void }): React.JSX.Element | null {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { has } = useCapabilities()
  const canApprove = has('books.approve')
  const detail = useQuery({
    queryKey: ['books', 'detail', item.book_id, item.version_id ?? null],
    queryFn: () => api.getBook(item.book_id, item.version_id ?? undefined),
    enabled: canApprove,
  })
  const book = detail.data
  const live = book?.versions?.at(-1)
  const current = book?.selected_version_id != null
    ? book.versions?.find((version) => version.id === book.selected_version_id)
    : live
  const steps = current?.approval_steps ?? book?.approval_steps ?? []
  const canDecide = canApprove && book?.approval_state === 'pending' && current != null &&
    current.version_no === live?.version_no && (item.version_id == null || current.id === item.version_id) &&
    isApproverAssignee(steps, user?.id)
  const canForward = canDecide && book?.can_forward_to_branch === true
  const isReport = book?.service_id === 'Report'
  const signingBranch = approverStep(steps)?.stage_label === 'branch_manager'
  const [decision, setDecision] = useState<'return' | 'reject' | null>(null)
  const [reason, setReason] = useState('')
  const [signOpen, setSignOpen] = useState(false)
  const [signNote, setSignNote] = useState('')
  const [forwardOpen, setForwardOpen] = useState(false)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const signRef = useRef<HTMLButtonElement>(null)
  const { decideMutation, signMutation } = useBookApprovalActions({
    bookId: item.book_id,
    versionId: current?.id,
    isReport,
    onDecided: onClose,
    onSigned: onClose,
  })
  const busy = decideMutation.isPending || signMutation.isPending

  if (!canDecide || !book || !current) return null

  const openDecision = (act: 'return' | 'reject'): void => {
    setReason('')
    setDecision(act)
    requestAnimationFrame(() => reasonRef.current?.focus())
  }

  return (
    <div className="space-y-3 border-t border-hairline p-4">
      <RecordDecisionActions
        busy={busy}
        pending={signMutation.isPending ? 'sign' : decideMutation.isPending && decideMutation.variables?.act !== 'note' ? decideMutation.variables?.act : null}
        review={isReport}
        canForwardToBranch={canForward}
        onForward={() => setForwardOpen(true)}
        onReturn={() => openDecision('return')}
        onReject={() => openDecision('reject')}
        onSign={() => { setSignNote(''); setSignOpen(true) }}
        signButtonRef={signRef}
      />
      {decision && (
        <DecisionReasonForm
          act={decision}
          reason={reason}
          reasonValid={reason.trim().length > 0}
          busy={busy}
          allowMarks={false}
          inputRef={reasonRef}
          onReasonChange={setReason}
          onCancel={() => setDecision(null)}
          onConfirm={(act) => decideMutation.mutate({ act, note: reason.trim() })}
        />
      )}
      <ConfirmDialog
        open={signOpen}
        onOpenChange={setSignOpen}
        title={t(isReport ? 'books.approval.reviewConfirmTitle' : 'books.approval.signConfirmTitle')}
        description={
          <div className="space-y-3">
            <p>{t(isReport ? 'books.approval.reviewConfirmBody' : 'books.approval.signConfirmBody', {
              ref: bidi(book.ref_number), version: current.version_no, subject: bidi(book.subject ?? ''),
            })}</p>
            {signingBranch && (
              <label className="block space-y-1 text-start">
                <span>{t('books.approval.branchNotes')}</span>
                <textarea dir="auto" rows={3} maxLength={1000} value={signNote} onChange={(event) => setSignNote(event.target.value)} className="block w-full rounded-lg border border-hairline bg-background px-3 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
            )}
          </div>
        }
        confirmLabel={t(canForward ? 'books.fleetReporter.approveFinish' : isReport ? 'books.approval.markReviewed' : 'books.approval.signApprove')}
        onConfirm={() => { if (!busy) signMutation.mutate(signingBranch ? signNote : undefined) }}
        returnFocusRef={signRef}
      />
      {forwardOpen && canForward && (
        <ForwardToBranchDialog bookId={book.id} versionId={current.id} onClose={() => setForwardOpen(false)} />
      )}
    </div>
  )
}
