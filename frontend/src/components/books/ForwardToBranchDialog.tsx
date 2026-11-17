import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { DialogRoot, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { api, apiErrorMessage } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { useCapabilities } from '@/lib/useCapabilities'
import { useBookApprovalActions } from './useBookApprovalActions'

interface Props {
  bookId: number
  versionId: number
  onClose: () => void
}

/** Only the live line-manager assignee is offered this revision-scoped handoff. */
export function ForwardToBranchDialog({ bookId, versionId, onClose }: Props): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const { has } = useCapabilities()
  const fieldId = useId()
  const [candidateId, setCandidateId] = useState('')
  const [note, setNote] = useState('')
  const [target] = useState({ bookId, versionId })
  const currentTarget = target.bookId === bookId && target.versionId === versionId
  useEffect(() => {
    if (!currentTarget) onClose()
  }, [currentTarget, onClose])
  const canApprove = has('books.approve')
  const candidates = useQuery({
    queryKey: ['books', 'branch-candidates', bookId, versionId],
    queryFn: () => api.listBranchCandidates(bookId),
    enabled: canApprove && currentTarget,
  })
  const { forwardMutation } = useBookApprovalActions({
    bookId: target.bookId,
    versionId: target.versionId,
    onForwarded: onClose,
  })
  const selected = candidates.data?.find((candidate) => String(candidate.id) === candidateId)

  if (!canApprove || !currentTarget) return null

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent dir={i18n.language.startsWith('ar') ? 'rtl' : 'ltr'} className="w-[calc(100%-2rem)]">
        <DialogHeader className="pe-12">
          <DialogTitle>{t('books.fleetReporter.forward')}</DialogTitle>
          <DialogDescription>{t('books.fleetReporter.forwardHint')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            if (!selected || forwardMutation.isPending) return
            forwardMutation.mutate({ branchApproverUserId: selected.id, note: note.trim() || undefined })
          }}
        >
          <div className="min-h-0 space-y-4 overflow-y-auto p-4">
            {candidates.isPending ? (
              <p role="status" className="text-sm text-muted-foreground">{t('common.loading')}</p>
            ) : candidates.isError ? (
              <div role="alert" className="space-y-2 text-sm text-destructive-text">
                <p>{apiErrorMessage(candidates.error)}</p>
                <Button type="button" variant="outline" onClick={() => void candidates.refetch()}>{t('common.retry')}</Button>
              </div>
            ) : candidates.data.length === 0 ? (
              <div className="rounded-lg border border-warning/40 bg-warning-soft/50 p-4">
                <p className="text-sm font-semibold text-foreground">{t('books.fleetReporter.noCandidatesTitle')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('books.fleetReporter.noCandidatesBody')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <label htmlFor={`${fieldId}-manager`} className="block text-sm font-medium text-foreground">{t('books.approval.branchManager')}</label>
                <select
                  id={`${fieldId}-manager`}
                  required
                  value={candidateId}
                  onChange={(event) => setCandidateId(event.target.value)}
                  className="w-full rounded-lg border border-hairline bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">{t('books.approval.selectBranchManager')}</option>
                  {candidates.data.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{pickEmployeeName({ name_en: candidate.name ?? '', name_ar: candidate.name_ar }, i18n.language)}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <label htmlFor={`${fieldId}-note`} className="block text-sm font-medium text-foreground">{t('books.fleetReporter.note')}</label>
              <textarea
                id={`${fieldId}-note`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                dir="auto"
                className="block w-full rounded-lg border border-hairline bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
          <footer className="flex flex-wrap justify-end gap-2 border-t border-hairline p-4">
            <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={!selected || forwardMutation.isPending} aria-busy={forwardMutation.isPending || undefined}>
              {t('books.fleetReporter.forward')}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </DialogRoot>
  )
}
