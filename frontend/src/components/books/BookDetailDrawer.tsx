/**
 * BookDetailDrawer — unified book detail surface: header, subject/meta, version
 * history, current approval chain, executed copies, and a state-driven footer.
 *
 * Footer (see `footerActionFor`):
 *  - caller owns the current pending step → approve/reject/return/note (`decide`)
 *  - state returned/rejected + `books.manage` → Revise & regenerate (`revise`)
 *  - state none + `books.manage` → Submit for approval (`submit`)
 *  - otherwise read-only
 *
 * Replaces the approval-only BookApprovalSheet; the approval bar behaviour
 * (decideBook + query invalidation + toast keys) is preserved verbatim.
 *
 * Props: `{ bookId; onClose; onSubmitForApproval }`
 */

import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { ar as arLocale } from 'date-fns/locale'
import { Check, Download, FileText, Paperclip, RotateCcw, Send, X } from 'lucide-react'

import { api, ApiError, type BookApprovalStepRead, type BookDecideAction, type BookVersionRead, apiErrorMessage } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { useAuth } from '@/lib/authContext'
import { cn } from '@/lib/utils'

import { footerActionFor } from './book-detail-drawer-utils'
import {
  approverStep,
  changesRequestedCount,
  isApproverAssignee,
  myPendingReviewerStep,
  reviewerSteps,
} from './reviewers'
import { ReviewerList } from './ReviewerList'
import { ReviewerActions } from './ReviewerActions'

interface Props {
  bookId: number | null
  onClose: () => void
  onSubmitForApproval: (bookId: number) => void
}

/** Coloured pill for a book/version state. */
function StatePill({ state }: { state: string }): React.JSX.Element {
  const { t } = useTranslation()
  const map: Record<string, { label: string; cls: string }> = {
    none: { label: t('books.approval.stateDraft'), cls: 'border-hairline bg-surface-tinted text-muted-foreground' },
    pending: { label: t('books.approval.statePending'), cls: 'border-accent/40 bg-accent/10 text-accent' },
    awaiting_scan: { label: t('books.approval.stateAwaitingScan'), cls: 'border-info/40 bg-info/10 text-info' },
    approved: { label: t('books.approval.stateApproved'), cls: 'border-success/40 bg-success/10 text-success' },
    rejected: { label: t('books.approval.stateRejected'), cls: 'border-destructive/40 bg-destructive/10 text-destructive' },
    returned: { label: t('books.approval.stateReturned'), cls: 'border-warning/40 bg-warning/10 text-warning' },
  }
  const m = map[state]
  if (!m) return <></>
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[0.7em] font-semibold', m.cls)}>
      {m.label}
    </span>
  )
}

/** One step in the approval timeline (copied from BookApprovalSheet). */
function ChainStep({
  step,
  isCurrent,
}: {
  step: BookApprovalStepRead
  isCurrent: boolean
}): React.JSX.Element {
  const isDone = step.state === 'approved'
  return (
    <li className="flex items-start gap-3">
      <span
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[0.6em]',
          isDone
            ? 'border-success bg-success text-white'
            : isCurrent
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-hairline bg-surface text-muted-foreground',
        )}
        aria-hidden
      >
        {isDone ? (
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
        ) : isCurrent ? (
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-hairline" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-[0.82em] font-semibold',
            isDone ? 'text-foreground' : isCurrent ? 'text-accent' : 'text-muted-foreground',
          )}
        >
          {step.stage_label}
        </p>
        {step.state === 'approved' && step.decided_at && (
          <p className="text-[0.72em] text-muted-foreground">{step.decided_at.slice(0, 10)}</p>
        )}
        {step.note && (
          <p className="mt-0.5 rounded-md bg-surface-tinted px-2 py-1 text-[0.72em] text-foreground">{step.note}</p>
        )}
      </div>
    </li>
  )
}

/** One row in the version-history list. */
function VersionRow({
  version,
  isCurrent,
}: {
  version: BookVersionRead
  isCurrent: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  // Latest note recorded against any step in this version.
  const latestNote = [...(version.approval_steps ?? [])].reverse().find((s) => s.note)?.note ?? null

  return (
    <li
      className={cn(
        'rounded-lg border px-3 py-2.5',
        isCurrent ? 'border-accent/40 bg-accent/5' : 'border-hairline bg-surface-tinted',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[0.78em] font-semibold text-foreground">v{version.version_no}</span>
        <StatePill state={version.status} />
        {isCurrent && (
          <span className="text-[0.7em] font-medium uppercase tracking-wider text-accent">
            {t('books.versions.current')}
          </span>
        )}
        <span className="ms-auto text-[0.72em] text-muted-foreground">
          {t(`books.versions.trigger.${version.trigger}`)}
        </span>
      </div>
      <p className="mt-1 text-[0.72em] text-muted-foreground">
        {version.created_by_name ?? '—'} · {version.created_at.slice(0, 10)}
      </p>
      {latestNote && (
        <p className="mt-1.5 rounded-md bg-surface px-2 py-1 text-[0.72em] text-foreground">{latestNote}</p>
      )}
      {/* Once signed, the only artifact offered is the signed PDF — the
          unsigned DOCX/PDF are withheld so the signed copy is canonical. */}
      {version.signed_pdf_url ? (
        <div className="mt-2 flex items-center gap-2">
          <a
            href={version.signed_pdf_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-2 py-1 text-[0.72em] font-medium text-foreground transition-colors hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Download className="h-3 w-3" strokeWidth={1.8} aria-hidden />
            {t('books.versions.signedPdf')}
          </a>
        </div>
      ) : (
        (version.docx_url || version.pdf_url) && (
          <div className="mt-2 flex items-center gap-2">
            {version.docx_url && (
              <a
                href={version.docx_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-2 py-1 text-[0.72em] font-medium text-foreground transition-colors hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Download className="h-3 w-3" strokeWidth={1.8} aria-hidden />
                DOCX
              </a>
            )}
            {version.pdf_url && (
              <a
                href={version.pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-2 py-1 text-[0.72em] font-medium text-foreground transition-colors hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Download className="h-3 w-3" strokeWidth={1.8} aria-hidden />
                PDF
              </a>
            )}
          </div>
        )
      )}
    </li>
  )
}

export function BookDetailDrawer({ bookId, onClose, onSubmitForApproval }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const dfLocale = isAr ? arLocale : undefined
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { has } = useCapabilities()
  const { user } = useAuth()
  const canApprove = has('books.approve')
  const canManage = has('books.manage')
  // Revise regenerates via POST /documents/generate, which requires this cap;
  // without it the committed Save would 403.
  const canGenerate = has('documents.generate')

  const [noteText, setNoteText] = useState('')
  // Which decide action the note input is collecting for. `note` = optional
  // free note; `return`/`reject` require a non-empty reason (backend enforces
  // it → REASON_REQUIRED), so the confirm is gated on a trimmed value.
  const [noteFor, setNoteFor] = useState<BookDecideAction | null>(null)

  const { data: book, isPending } = useQuery({
    queryKey: ['books', 'detail', bookId],
    queryFn: () => api.getBook(bookId!),
    enabled: bookId !== null,
  })

  const versions = book?.versions ?? []
  const current = versions.length > 0 ? versions[versions.length - 1] : undefined
  // Graceful degradation: detail endpoint always populates versions; the second
  // fallback (book?.approval_steps) covers list-shaped data that lacks versions.
  // Do not remove — it prevents an empty chain when bookId changes before refetch.
  // Annotate as the api.ts alias (extra fields kind/seen_at/assignee_name are
  // optional, so the base nested step type is assignable) — the generated nested
  // approval_steps type lacks them until `gen:api` is run.
  const currentSteps: BookApprovalStepRead[] = current?.approval_steps ?? book?.approval_steps ?? []
  const isAssignee = isApproverAssignee(currentSteps, user?.id)
  const myReview = myPendingReviewerStep(currentSteps, user?.id)
  const currentStepIndex = currentSteps.findIndex((s) => s.state !== 'approved')

  const action = footerActionFor(book?.approval_state ?? 'none', {
    canManage,
    canApprove,
    isAssignee,
    isReviewer: myReview != null,
  })

  // Seen-on-open: when the loaded book has a step assigned to the current user
  // with no seen_at, fire one POST /books/{id}/seen then invalidate.
  const myStep = currentSteps.find((s) => s.assignee_user_id === user?.id)
  useEffect(() => {
    if (book && myStep && !myStep.seen_at) {
      api
        .markBookSeen(book.id)
        .then(() => void qc.invalidateQueries({ queryKey: ['books', 'detail', book.id] }))
        .catch(() => {})
    }
    // Re-run only when the book or step identity/seen_at changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id, myStep?.id, myStep?.seen_at])

  const decideMutation = useMutation({
    mutationFn: ({ act, note }: { act: BookDecideAction; note?: string }) =>
      api.decideBook(book!.id, act, note),
    onSuccess: (_data, { act }) => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['books', 'awaiting'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      const key =
        act === 'reject'
          ? 'books.approval.rejected'
          : act === 'return'
            ? 'books.approval.returned'
            : 'books.approval.noteAdded'
      toast.success(t(key))
      setNoteText('')
      setNoteFor(null)
      onClose()
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  // Approval == signing: embeds the signed-in manager's signature and marks the
  // book approved. A NO_SIGNATURE error means the user must add a signing
  // signature in Settings first.
  const signMutation = useMutation({
    mutationFn: () => api.signBook(book!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['books', 'awaiting'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(t('books.approval.signed'))
      onClose()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'NO_SIGNATURE') {
        toast.error(t('books.approval.noSignatureHint'))
      } else {
        toast.error(apiErrorMessage(err))
      }
    },
  })

  function handleDecide(act: BookDecideAction): void {
    // First click reveals the input (switching action if a different one was
    // open). `return`/`reject` require a reason; `note` is free-form.
    if (noteFor !== act) {
      setNoteFor(act)
      setNoteText('')
      return
    }
    if (act !== 'note' && noteText.trim().length === 0) return
    decideMutation.mutate({ act, note: noteText.trim() || undefined })
  }

  function handleRevise(): void {
    if (!book || !current?.template_id) return
    navigate(`/application?form=${encodeURIComponent(current.template_id)}`, {
      state: { reviseBookId: book.id },
    })
    onClose()
  }

  function relTime(iso: string | null | undefined): string {
    if (!iso) return ''
    try {
      return formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: dfLocale })
    } catch {
      return iso.slice(0, 10)
    }
  }

  const priIsHigh = book?.priority === 'High'

  return (
    <Dialog.Root open={bookId !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-300',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200',
            'motion-reduce:animate-none',
          )}
        />
        <Dialog.Content
          className={cn(
            // `.drawer-end` carries the motion: bottom-sheet slide-up on mobile,
            // inline-end side-panel slide above md (RTL-aware, reduced-motion
            // guarded in index.css).
            'drawer-end fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl bg-surface shadow-2xl',
            'focus-visible:outline-none',
            // `md:start-auto` clears the mobile `inset-x-0` left edge so the panel
            // pins to the inline-end (right in LTR, left in RTL), not the start.
            'md:inset-y-0 md:start-auto md:end-0 md:bottom-auto md:max-h-none md:h-dvh md:w-full md:max-w-md md:rounded-none md:rounded-s-2xl',
          )}
          aria-modal
        >
          {/* grabber (mobile) */}
          <span aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-hairline md:hidden" />

          {/* header */}
          <header className="flex items-center gap-2.5 border-b border-hairline px-5 py-3.5">
            {book?.ref_number && (
              <span className="rounded-md bg-surface-tinted px-2 py-0.5 font-mono text-[0.78em] font-semibold text-foreground">
                {book.ref_number}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-[0.82em] text-muted-foreground">
              {isAr ? book?.category?.name_ar ?? book?.category?.name_en : book?.category?.name_en}
            </span>
            {book && <StatePill state={book.approval_state} />}
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={t('common.close')}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </Dialog.Close>
          </header>

          {/* scrollable body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-4">
            {isPending ? (
              <div className="flex flex-col gap-3 py-2">
                <div className="h-4 w-3/4 animate-pulse rounded bg-surface-tinted" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-surface-tinted" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-surface-tinted" />
              </div>
            ) : (
              <>
                {/* meta */}
                <dl className="mb-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[0.82em]">
                  <dt className="font-medium text-muted-foreground">{t('books.approval.submitter')}</dt>
                  <dd className="text-foreground">{book?.submitted_by_name ?? '—'}</dd>

                  <dt className="font-medium text-muted-foreground">{t('books.approval.priority')}</dt>
                  <dd className={cn('flex items-center gap-1.5 font-semibold', priIsHigh ? 'text-accent' : 'text-muted-foreground')}>
                    <span aria-hidden className="h-2 w-2 rounded-full bg-current" />
                    {priIsHigh ? t('books.approval.high') : t('books.approval.normal')}
                  </dd>

                  <dt className="font-medium text-muted-foreground">{t('books.approval.submittedAt')}</dt>
                  <dd className="font-mono text-muted-foreground text-[0.92em]">
                    {book?.created_at ? relTime(book.created_at) : '—'}
                  </dd>
                </dl>

                {/* subject */}
                {book?.subject && (
                  <div className="mb-4">
                    <h3 className="mb-1.5 text-[0.72em] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t('books.columns.subject')}
                    </h3>
                    <p className="rounded-lg bg-surface-tinted px-3 py-2.5 text-[0.88em] leading-relaxed text-foreground">
                      {book.subject}
                    </p>
                  </div>
                )}

                {/* version history (newest first) */}
                {versions.length > 0 && (
                  <div className="mb-4">
                    <h3 className="mb-2.5 text-[0.72em] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t('books.versions.title')}
                    </h3>
                    <ul className="flex flex-col gap-2">
                      {[...versions].reverse().map((v) => (
                        <VersionRow key={v.id} version={v} isCurrent={current?.id === v.id} />
                      ))}
                    </ul>
                  </div>
                )}

                {/* current approval chain — approver only; reviewers render below */}
                {currentSteps.length > 0 && (
                  <div className="mb-4">
                    <h3 className="mb-2.5 text-[0.72em] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t('books.approval.approvalChain')}
                    </h3>
                    <ol className="flex flex-col gap-3">
                      {approverStep(currentSteps) && (
                        <ChainStep
                          step={approverStep(currentSteps)!}
                          isCurrent={currentStepIndex === currentSteps.findIndex((s) => !('kind' in s && s.kind === 'reviewer'))}
                        />
                      )}
                    </ol>
                  </div>
                )}

                {/* reviewer rows */}
                <ReviewerList reviewers={reviewerSteps(currentSteps)} />

                {/* executed copies (copied from BookApprovalSheet) */}
                {book && book.attachment_paths && book.attachment_paths.length > 0 && (
                  <div className="mb-4">
                    <h3 className="mb-2.5 text-[0.72em] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t('books.executedCopy.title')}
                    </h3>
                    <ul className="flex flex-col gap-1.5">
                      {book.attachment_paths.map((rel, i) => {
                        const filename = rel.split('/').pop() ?? rel
                        return (
                          <li key={`${rel}-${i}`}>
                            <a
                              href={`/api/v1/books/${book.id}/attachments/${i}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 rounded-lg border border-hairline bg-surface-tinted px-3 py-2 text-[0.82em] text-foreground transition-colors hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden />
                              <span className="min-w-0 flex-1 truncate" dir="auto">{filename}</span>
                            </a>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}

                {/* note / reason input (decide flow) */}
                {action === 'decide' && noteFor && (
                  <div className="mb-4">
                    <label className="mb-1 block text-[0.8em] font-medium text-muted-foreground">
                      {noteFor === 'note'
                        ? t('books.approval.addNote')
                        : `${noteFor === 'reject' ? t('books.approval.reject') : t('books.approval.return')} · ${t('books.approval.reasonLabel')}`}
                    </label>
                    <textarea
                      rows={3}
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder={noteFor === 'note' ? undefined : t('books.approval.reasonPlaceholder')}
                      className="w-full rounded-lg border border-hairline bg-background px-3 py-2 text-[0.88em] text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                      dir="auto"
                    />
                    {noteFor !== 'note' && noteText.trim().length === 0 && (
                      <p className="mt-1 text-[0.74em] text-muted-foreground">
                        {t('books.approval.reasonRequired')}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* override banner: approver sees reviewers' change requests */}
          {action === 'decide' && changesRequestedCount(currentSteps) > 0 && (
            <div
              className="mx-5 mb-3 mt-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[0.78em] text-warning"
              data-testid="override-banner"
            >
              {t('books.reviewers.overrideBanner', { count: changesRequestedCount(currentSteps) })}
            </div>
          )}

          {/* reviewer footer */}
          {action === 'review' && book && (
            <footer className="border-t border-hairline px-5 py-4">
              <ReviewerActions bookId={book.id} onDone={onClose} />
            </footer>
          )}

          {/* state-driven footer */}
          {action === 'decide' && (
            <footer className="border-t border-hairline px-5 py-4">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={
                    decideMutation.isPending ||
                    signMutation.isPending ||
                    (noteFor === 'reject' && noteText.trim().length === 0)
                  }
                  onClick={() => handleDecide('reject')}
                  className={cn(
                    'flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[0.82em] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                    noteFor === 'reject'
                      ? 'border-destructive bg-destructive text-white hover:bg-destructive/90'
                      : 'border-hairline text-destructive hover:bg-destructive/10',
                  )}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
                  {t('books.approval.reject')}
                </button>

                <button
                  type="button"
                  disabled={
                    decideMutation.isPending ||
                    signMutation.isPending ||
                    (noteFor === 'return' && noteText.trim().length === 0)
                  }
                  onClick={() => handleDecide('return')}
                  className={cn(
                    'flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[0.82em] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                    noteFor === 'return'
                      ? 'border-warning bg-warning text-white hover:bg-warning/90'
                      : 'border-hairline text-warning hover:bg-warning/10',
                  )}
                >
                  <FileText className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                  {t('books.approval.return')}
                </button>

                <button
                  type="button"
                  disabled={decideMutation.isPending || signMutation.isPending}
                  onClick={() => handleDecide('note')}
                  className={cn(
                    'flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[0.82em] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                    noteFor === 'note'
                      ? 'border-primary bg-primary text-primary-foreground hover:bg-primary-hover'
                      : 'border-hairline text-foreground hover:bg-surface-tinted',
                  )}
                >
                  {t('books.approval.addNote')}
                </button>

                <button
                  type="button"
                  disabled={decideMutation.isPending || signMutation.isPending}
                  onClick={() => signMutation.mutate()}
                  className="ms-auto flex h-9 items-center gap-1.5 rounded-lg bg-success px-4 text-[0.82em] font-semibold text-white transition-colors hover:bg-success/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                  {t('books.approval.signApprove')}
                </button>
              </div>
            </footer>
          )}

          {action === 'revise' && (
            <footer className="border-t border-hairline px-5 py-4">
              <p className="mb-2 text-[0.78em] text-muted-foreground">{t('books.versions.reviseHint')}</p>
              <button
                type="button"
                disabled={!current?.template_id || !current?.has_fields || !canGenerate}
                onClick={handleRevise}
                className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-[0.82em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                {t('books.versions.revise')}
              </button>
            </footer>
          )}

          {action === 'submit' && book && (
            <footer className="border-t border-hairline px-5 py-4">
              <button
                type="button"
                onClick={() => onSubmitForApproval(book.id)}
                className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-[0.82em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Send className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                {t('books.approval.submitForApproval')}
              </button>
            </footer>
          )}

          <Dialog.Title className="sr-only">{book?.ref_number ?? t('books.approval.awaitingTitle')}</Dialog.Title>
          <Dialog.Description className="sr-only">{t('books.approval.sheetDescription')}</Dialog.Description>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
