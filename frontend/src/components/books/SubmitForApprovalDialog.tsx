/**
 * SubmitForApprovalDialog — modal for submitting a book into the approval flow.
 *
 * Props: { bookId: number | null; onClose: () => void }
 *
 * Features:
 *  - Priority toggle (Normal / High)
 *  - Manager pre-fill: reads doc_manager_user_id / doc_manager_name from the
 *    book. Renders a read-only chip + "Change" affordance when linked, falling
 *    back to the approver <select> otherwise or after "Change" is clicked.
 *  - No-signature warning (amber inline note) when the linked manager has no
 *    signature on file. Submit stays ENABLED (lenient — manager adds it later).
 *  - Reviewers multi-select (bounded checkbox list) from listReviewerCandidates,
 *    excluding the currently-selected approver.
 *  - Submit calls api.submitBook, invalidates ['books'], ['books','awaiting'],
 *    ['dashboard'], shows a toast, calls onClose()
 *  - Gated behind books.manage (caller already gates the trigger)
 */

import { useState } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { CheckCircle2, X } from 'lucide-react'

import { api, ApiError, type ApproverOptionRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'

interface Props {
  bookId: number
  onClose: () => void
}

export function SubmitForApprovalDialog({ bookId, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { has } = useCapabilities()
  const canManage = has('books.manage')
  const canApprove = has('books.approve')

  const [priority, setPriority] = useState<'Normal' | 'High'>('Normal')
  // The backend requires EXACTLY ONE signing manager, so the picker is
  // single-select rather than an ordered chain. `null` = untouched (the
  // linked manager or default manager preselects); '' = explicitly reset
  // by the user via "Change" — never overridden after that.
  const [pickedUserId, setPickedUserId] = useState<string | null>(null)

  // Reviewer ids selected in the checkbox list.
  const [reviewerIds, setReviewerIds] = useState<number[]>([])

  // --- book detail (for linked manager) ---
  const bookQuery = useQuery({
    queryKey: ['books', 'detail', bookId],
    queryFn: () => api.getBook(bookId),
    enabled: canManage,
    staleTime: 60_000,
  })
  const book = bookQuery.data
  const docManagerUserId: number | null = book?.doc_manager_user_id ?? null
  const docManagerName: string | null = book?.doc_manager_name ?? null
  const docManagerHasSignature: boolean = book?.doc_manager_has_signature ?? true

  // --- approver candidates (for the <select> fallback) ---
  const approversQuery = useQuery({
    queryKey: ['books', 'approvers'],
    queryFn: () => api.listApprovers(),
    enabled: canManage,
    staleTime: 5 * 60_000,
  })

  const approvers: ApproverOptionRead[] = approversQuery.data ?? []

  // Preselect the admin-designated default manager (forms signing paths,
  // 2026-06-11 §5) while the picker is untouched — derived, not synced
  // via an effect, so the options can land after the first render without reset.
  const defaultApproverId = approvers.find((a) => a.is_default)?.id

  // Effective selected user id:
  //  1. pickedUserId (explicit user choice via <select> or "Change")
  //  2. linked doc manager id
  //  3. default approver from the list
  //  4. ''
  const selectedUserId =
    pickedUserId ??
    (docManagerUserId != null
      ? String(docManagerUserId)
      : defaultApproverId != null
        ? String(defaultApproverId)
        : '')

  // Whether we're showing the linked-manager chip (not manually overridden).
  const showLinkedChip = docManagerUserId != null && pickedUserId === null

  // --- reviewer candidates ---
  const reviewerQuery = useQuery({
    queryKey: ['books', 'reviewer-candidates'],
    queryFn: () => api.listReviewerCandidates(),
    enabled: canManage,
    staleTime: 5 * 60_000,
  })

  // Exclude the currently selected approver from reviewer list.
  const selectedApproverIdNum = Number.parseInt(selectedUserId, 10)
  const reviewerCandidates: ApproverOptionRead[] = (reviewerQuery.data ?? []).filter(
    (r) => r.id !== selectedApproverIdNum,
  )

  function toggleReviewer(id: number) {
    setReviewerIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const submitMutation = useMutation({
    mutationFn: () =>
      api.submitBook(bookId, {
        priority,
        approver_user_id: Number.parseInt(selectedUserId, 10),
        reviewer_user_ids: reviewerIds,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['books', 'awaiting'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      // Rare milestone — mark it with a one-shot settling check (frequency
      // gate; reduced-motion guarded by .anim-check-settle in index.css).
      toast.success(t('books.approval.submitted'), {
        icon: <CheckCircle2 className="anim-check-settle h-4 w-4 text-success" strokeWidth={2} />,
      })
      onClose()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.message === 'APPROVER_REQUIRED') {
        toast.error(t('books.approval.managerNotLinked'))
      } else {
        toast.error(err instanceof ApiError ? err.message : String(err))
      }
    },
  })

  // submit is enabled as soon as a valid approver id is chosen or the linked
  // manager is in place. No-signature warning does NOT disable submit (lenient).
  const canSubmit = Number.isFinite(Number.parseInt(selectedUserId, 10))

  if (!canManage) return <></>

  // Whether we should show the approver <select> (no linked manager, or user clicked "Change")
  const showApproverSelect = !showLinkedChip

  // Loading: both book + approvers need to be ready before we show anything.
  const isLoading = bookQuery.isPending || (showApproverSelect && approversQuery.isPending)

  return (
    <RadixDialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-300',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200',
            'motion-reduce:animate-none',
          )}
        />
        <RadixDialog.Content
          className={cn(
            // `.bottom-sheet` carries the motion: slide-up from translateY(100%)
            // on mobile, zoom+fade (with centering preserved) above md. Both
            // reduced-motion guarded in index.css.
            'bottom-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl bg-surface shadow-2xl',
            'focus-visible:outline-none',
            'md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[80dvh] md:w-full md:max-w-lg',
            'md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl',
          )}
          aria-modal
        >
          {/* grabber (mobile) */}
          <span
            aria-hidden
            className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-hairline md:hidden"
          />

          {/* header */}
          <header className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3.5">
            <RadixDialog.Title className="text-[0.9em] font-semibold text-foreground">
              {t('books.approval.submitForApproval')}
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <button
                type="button"
                aria-label={t('common.close')}
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </RadixDialog.Close>
          </header>

          {/* scrollable body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Priority toggle */}
            <div>
              <p className="mb-2 text-[0.78em] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('books.approval.priority')}
              </p>
              <div className="inline-flex rounded-lg border border-hairline bg-surface-tinted p-0.5">
                {(['Normal', 'High'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setPriority(opt)}
                    className={cn(
                      'rounded-md px-3.5 py-1.5 text-[0.82em] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      priority === opt
                        ? opt === 'High'
                          ? 'bg-accent text-white shadow-sm'
                          : 'bg-surface text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t(`books.approval.${opt.toLowerCase()}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* Signing manager — exactly one (the backend rejects more). */}
            <div>
              <p className="mb-2 text-[0.78em] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('books.approval.signingManager')}
              </p>

              {isLoading ? (
                <div className="h-10 w-full animate-pulse rounded-lg bg-surface-tinted" />
              ) : showLinkedChip ? (
                /* Linked manager chip — read-only, with a "Change" escape hatch */
                <div>
                  <div
                    className="flex items-center justify-between rounded-lg border border-hairline bg-surface-tinted px-3 py-2"
                    data-testid="linked-manager-chip"
                  >
                    <span className="text-[0.84em] font-medium text-foreground">
                      {docManagerName}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPickedUserId('')}
                      className="ml-3 text-[0.76em] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    >
                      {t('books.approval.changeManager')}
                    </button>
                  </div>
                  {/* No-signature warning — submit stays enabled (lenient) */}
                  {!docManagerHasSignature && (
                    <div
                      className="mt-2 rounded-lg border border-warning/40 bg-warning-soft/50 px-3 py-2"
                      data-testid="no-signature-warning"
                    >
                      <p className="text-[0.8em] text-foreground">
                        {t('books.approval.managerNoSignature')}{' '}
                        <button
                          type="button"
                          onClick={() => { onClose(); navigate('/settings') }}
                          className="text-primary underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        >
                          {t('books.approval.managerNoSignatureLink')}
                        </button>
                      </p>
                    </div>
                  )}
                </div>
              ) : approvers.length === 0 ? (
                /* Empty state: no approvers configured at all */
                <div className="rounded-lg border border-warning/40 bg-warning-soft/50 p-4">
                  <p className="text-[0.84em] font-semibold text-foreground">{t('books.approval.noApproversTitle')}</p>
                  <p className="mt-1 text-[0.8em] text-muted-foreground">{t('books.approval.noApproversBody')}</p>
                  {canApprove && (
                    <p className="mt-1 text-[0.8em] text-muted-foreground">{t('books.approval.noApproversSelfHint')}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => { onClose(); navigate('/settings') }}
                    className="mt-3 inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[0.8em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('books.approval.goToSettings')}
                  </button>
                </div>
              ) : (
                /* Approver <select> — shown when no linked manager, or after "Change" */
                <>
                  <select
                    value={selectedUserId}
                    onChange={(e) => setPickedUserId(e.target.value)}
                    className="w-full rounded-lg border border-hairline bg-background px-3 py-2 text-[0.84em] text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                    aria-label={t('books.approval.signingManager')}
                  >
                    <option value="">{t('books.approval.selectApprover')}</option>
                    {approvers.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  <p className="mt-2 text-[0.76em] text-muted-foreground">{t('books.approval.singleSignerHint')}</p>
                </>
              )}
            </div>

            {/* Reviewers multi-select (optional) */}
            {canSubmit && reviewerCandidates.length > 0 && (
              <div>
                <p className="mb-1 text-[0.78em] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('books.approval.reviewers')}
                </p>
                <p className="mb-2 text-[0.76em] text-muted-foreground">
                  {t('books.approval.reviewersHint')}
                </p>
                <div
                  className="max-h-56 overflow-y-auto rounded-lg border border-hairline bg-background"
                  data-testid="reviewer-list"
                >
                  {reviewerCandidates.map((r) => (
                    <label
                      key={r.id}
                      className="flex cursor-pointer items-center gap-2.5 border-b border-hairline px-3 py-2.5 last:border-b-0 hover:bg-surface-tinted"
                    >
                      <input
                        type="checkbox"
                        checked={reviewerIds.includes(r.id)}
                        onChange={() => toggleReviewer(r.id)}
                        className="h-4 w-4 rounded border-hairline accent-primary"
                      />
                      <span className="text-[0.84em] text-foreground">{r.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* footer */}
          <footer className="border-t border-hairline px-5 py-4">
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-hairline px-4 py-2 text-[0.84em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('common.cancel')}
              </button>
              {(showLinkedChip || approvers.length > 0) && (
                <button
                  type="button"
                  disabled={!canSubmit || submitMutation.isPending}
                  onClick={() => submitMutation.mutate()}
                  className="rounded-lg bg-primary px-4 py-2 text-[0.84em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                >
                  {t('books.approval.submitForApproval')}
                </button>
              )}
            </div>
          </footer>

          <RadixDialog.Description className="sr-only">
            {t('books.approval.submitForApproval')}
          </RadixDialog.Description>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
