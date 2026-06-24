/**
 * BookRecordPage — full-page record screen (Slice 2 of the signing redesign).
 *
 * Full-page route (`/books/:id`): the document large on a "desk" (left), a
 * vertical progress timeline pinned to the PHYSICAL right (both LTR + RTL), a
 * header with submitter identity + Print + state-driven actions. Reuses
 * DocPdfCanvas (multi-page, IDM-safe). Action logic mirrors BookDetailDrawer
 * (sign / decide-with-reason / revise / submit + query invalidation).
 */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Check,
  CornerUpLeft,
  Loader2,
  PenLine,
  Printer,
  Send,
  Upload,
  X,
} from 'lucide-react'

import { api, ApiError, type BookApprovalStepRead, type BookDecideAction, type BookVersionRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { useCapabilities } from '@/lib/useCapabilities'
import { footerActionFor } from '@/components/books/book-detail-drawer-utils'
import {
  changesRequestedCount,
  isApproverAssignee,
  myPendingReviewerStep,
  reviewerSteps,
} from '@/components/books/reviewers'
import { ReviewerList } from '@/components/books/ReviewerList'
import { ReviewerActions } from '@/components/books/ReviewerActions'
import { SubmitForApprovalDialog } from '@/components/books/SubmitForApprovalDialog'
import { BookAnnotationLayer } from '@/components/books/BookAnnotationLayer'
import { hasCommentBearingMark } from '@/components/books/annotation-utils'
import { cn } from '@/lib/utils'

import { sealDescriptor, signedSourceOf, type SealTone } from './bookStateLabel'

const DocPdfCanvas = lazy(() => import('@/pages/application/DocPdfCanvas'))

type TFn = (key: string, opts?: Record<string, unknown>) => string

type StationState = 'done' | 'live' | 'future'
interface Station {
  key: string
  icon: React.ReactNode
  label: string
  meta: string
  note?: string | null
  state: StationState
  tone: 'navy' | 'amber' | 'green' | 'red' | 'blue'
}

/** Derive the "life of the document" from versions + approval state.
 * `signedSource` nuances the terminal stations: a scan-path book waits at the
 * printer (awaiting_scan), and a scan-back approval reads "Signed · scanned". */
function buildTimeline(
  versions: BookVersionRead[],
  approvalState: string,
  submitter: string,
  t: TFn,
  signedSource?: 'in_app' | 'scan' | null,
): Station[] {
  const out: Station[] = []
  const sorted = [...versions].sort((a, b) => a.version_no - b.version_no)

  sorted.forEach((v) => {
    if (v.version_no === 1) {
      out.push({
        key: `sub-${v.id}`,
        icon: <Upload className="h-[15px] w-[15px]" strokeWidth={2} />,
        label: t('books.record.stationSubmitted'),
        meta: `${submitter} · v1 · ${v.created_at.slice(0, 10)}`,
        state: 'done',
        tone: 'navy',
      })
    } else {
      out.push({
        key: `rev-${v.id}`,
        icon: <CornerUpLeft className="h-[15px] w-[15px] -scale-x-100" strokeWidth={2} />,
        label: t('books.record.stationRevised'),
        meta: `${v.created_by_name ?? submitter} · v${v.version_no}`,
        state: 'done',
        tone: 'blue',
      })
    }
    const note = [...v.approval_steps].reverse().find((s) => s.note)?.note ?? null
    if (v.status === 'returned') {
      out.push({
        key: `ret-${v.id}`,
        icon: <CornerUpLeft className="h-[15px] w-[15px]" strokeWidth={2} />,
        label: t('books.record.stationReturned'),
        meta: `v${v.version_no}`,
        note,
        state: 'done',
        tone: 'amber',
      })
    } else if (v.status === 'rejected') {
      out.push({
        key: `rej-${v.id}`,
        icon: <X className="h-[15px] w-[15px]" strokeWidth={2.4} />,
        label: t('books.record.stationRejected'),
        meta: `v${v.version_no}`,
        note,
        state: 'done',
        tone: 'red',
      })
    }
  })

  // terminal station
  const currentVersion = sorted[sorted.length - 1]
  const signedAt =
    currentVersion?.approval_steps?.find((s) => s.state === 'approved')?.decided_at ?? null
  if (approvalState === 'pending') {
    out.push({
      key: 'await',
      icon: <PenLine className="h-[15px] w-[15px]" strokeWidth={2} />,
      label: t('books.record.stationAwaiting'),
      meta: t('books.record.metaManager'),
      state: 'live',
      tone: 'amber',
    })
    out.push({
      key: 'signed-future',
      icon: <Check className="h-[15px] w-[15px]" strokeWidth={2.6} />,
      label: t('books.record.stationSigned'),
      meta: t('books.record.metaPending'),
      state: 'future',
      tone: 'green',
    })
  } else if (approvalState === 'awaiting_scan') {
    out.push({
      key: 'await-scan',
      icon: <Printer className="h-[15px] w-[15px]" strokeWidth={2} />,
      label: t('books.record.stationAwaitingScan'),
      meta: t('books.record.metaAwaitingScan'),
      state: 'live',
      tone: 'blue',
    })
    out.push({
      key: 'signed-future',
      icon: <Check className="h-[15px] w-[15px]" strokeWidth={2.6} />,
      label: t('books.record.stationSignedScanned'),
      meta: t('books.record.metaPending'),
      state: 'future',
      tone: 'green',
    })
  } else if (approvalState === 'approved') {
    const scanned = signedSource === 'scan'
    out.push({
      key: 'signed',
      icon: <Check className="h-[15px] w-[15px]" strokeWidth={2.6} />,
      label: scanned
        ? t('books.record.stationSignedScanned')
        : t('books.record.stationSigned'),
      meta: scanned
        ? t('books.record.metaScanned')
        : signedAt
          ? `${t('books.record.metaManager')} · ${signedAt.slice(0, 10)}`
          : t('books.record.metaManager'),
      state: 'live',
      tone: 'green',
    })
  } else if (approvalState === 'none') {
    out.push({
      key: 'draft',
      icon: <Send className="h-[15px] w-[15px]" strokeWidth={2} />,
      label: t('books.record.stationNotSubmitted'),
      meta: t('books.record.metaDraft'),
      state: 'live',
      tone: 'navy',
    })
  }
  return out
}

const TONE: Record<Station['tone'], { bg: string; fg: string }> = {
  navy: { bg: 'var(--primary-soft)', fg: 'var(--primary)' },
  amber: { bg: 'var(--warning-soft)', fg: 'var(--warning)' },
  green: { bg: 'var(--success-soft)', fg: 'var(--success)' },
  red: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  blue: { bg: 'var(--info-soft)', fg: 'var(--info)' },
}

// sealDescriptor tone → this page's Station tone vocabulary.
const SEAL_TO_STATION_TONE: Record<SealTone, Station['tone']> = {
  neutral: 'navy',
  warning: 'amber',
  success: 'green',
  accent: 'red',
  info: 'blue',
}

function StatePill({
  state,
  signingPath,
  signedSource,
}: {
  state: string
  signingPath?: string | null
  signedSource?: string | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const d = sealDescriptor(state, { signingPath, signedSource })
  const c = TONE[SEAL_TO_STATION_TONE[d.tone]]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.72em] font-bold uppercase tracking-[0.04em]"
      style={{ background: c.bg, color: c.fg }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.fg }} />
      {t(d.labelKey)}
    </span>
  )
}

export function BookRecordPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const bookId = Number(id)

  const qc = useQueryClient()
  const { user } = useAuth()
  const { has } = useCapabilities()
  const canApprove = has('books.approve')
  const canManage = has('books.manage')
  // Revise regenerates via POST /documents/generate, which requires this cap;
  // without it the committed Save would 403.
  const canGenerate = has('documents.generate')

  const [submitOpen, setSubmitOpen] = useState(false)
  // Inline reason panel for return/reject (backend requires a non-empty reason).
  const [decision, setDecision] = useState<'return' | 'reject' | null>(null)
  const [reason, setReason] = useState('')

  const { data: book, isPending, isError, refetch } = useQuery({
    queryKey: ['books', 'detail', bookId],
    queryFn: () => api.getBook(bookId),
    enabled: Number.isFinite(bookId),
  })

  const versions = book?.versions ?? []
  const current = versions.length ? versions[versions.length - 1] : undefined
  const pdfUrl = current?.document_id
    ? `/api/v1/documents/${current.document_id}/download?format=pdf`
    : null

  const submitter = book?.submitted_by_name ?? '—'
  const state = book?.approval_state ?? 'none'
  const signedSource = book ? signedSourceOf(book) : null

  const stations = useMemo(
    () =>
      book ? buildTimeline(versions, book.approval_state, submitter, t, signedSource) : [],
    [book, versions, submitter, t, signedSource],
  )

  // Mirror BookDetailDrawer's assignee/footer derivation (with reviewer support).
  // Annotate as the api.ts alias (extra fields kind/seen_at/assignee_name are
  // optional, so the base nested step type is assignable) — the generated nested
  // approval_steps type lacks them until `gen:api` is run.
  const currentSteps: BookApprovalStepRead[] = current?.approval_steps ?? book?.approval_steps ?? []
  const isAssignee = isApproverAssignee(currentSteps, user?.id)
  const myReview = myPendingReviewerStep(currentSteps, user?.id)
  const action = footerActionFor(state, {
    canManage,
    canApprove,
    isAssignee,
    isReviewer: myReview != null,
  })

  // Seen-on-open: fire once when the current user has a step with no seen_at.
  const myStep = currentSteps.find((s) => s.assignee_user_id === user?.id)
  useEffect(() => {
    if (book && myStep && !myStep.seen_at) {
      api
        .markBookSeen(book.id)
        .then(() => void qc.invalidateQueries({ queryKey: ['books', 'detail', book.id] }))
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id, myStep?.id, myStep?.seen_at])

  // Annotation overlay (Slice 3). Marks live on the current version; shown while
  // the book is in an active review state.
  const annotatable = state === 'pending' || state === 'returned' || state === 'rejected'
  const annMode: 'view' | 'mark' = state === 'pending' && action === 'decide' ? 'mark' : 'view'
  const { data: annotations = [] } = useQuery({
    queryKey: ['books', 'annotations', bookId, current?.id],
    queryFn: () => api.listBookAnnotations(bookId, current!.id),
    enabled: annotatable && Number.isFinite(bookId) && current?.id != null,
  })

  const createMark = useMutation({
    mutationFn: (m: {
      page: number
      kind: 'pin' | 'highlight'
      geometry: Record<string, number>
      comment: string
    }) => api.createBookAnnotation(bookId, current!.id, m),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['books', 'annotations', bookId, current?.id] }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : String(err)),
  })
  const deleteMark = useMutation({
    mutationFn: (annId: number) => api.deleteBookAnnotation(bookId, current!.id, annId),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['books', 'annotations', bookId, current?.id] }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  function invalidateAll(): void {
    void qc.invalidateQueries({ queryKey: ['books'] })
    void qc.invalidateQueries({ queryKey: ['books', 'awaiting'] })
    void qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const decideMutation = useMutation({
    mutationFn: ({ act, note }: { act: BookDecideAction; note: string }) =>
      api.decideBook(book!.id, act, note),
    onSuccess: (_data, { act }) => {
      invalidateAll()
      toast.success(t(act === 'reject' ? 'books.approval.rejected' : 'books.approval.returned'))
      setDecision(null)
      setReason('')
      navigate('/books')
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  // Approval == signing: embeds the signed-in manager's signature and marks the
  // book approved. NO_SIGNATURE → must add a signing signature in Settings.
  const signMutation = useMutation({
    mutationFn: () => api.signBook(book!.id),
    onSuccess: () => {
      invalidateAll()
      toast.success(t('books.approval.signed'))
      navigate('/books')
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'NO_SIGNATURE') {
        toast.error(t('books.approval.noSignatureHint'))
      } else {
        toast.error(err instanceof ApiError ? err.message : String(err))
      }
    },
  })

  function handleRevise(): void {
    if (!book || !current?.template_id) return
    navigate(`/application?form=${encodeURIComponent(current.template_id)}`, {
      state: { reviseBookId: book.id },
    })
  }

  const busy = decideMutation.isPending || signMutation.isPending
  const canRevise = Boolean(current?.template_id && current?.has_fields && canGenerate)
  const reasonValid = reason.trim().length > 0 || hasCommentBearingMark(annotations)

  if (isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <X className="h-8 w-8 text-accent" strokeWidth={1.6} aria-hidden />
        <p className="text-sm font-medium text-foreground">{t('books.record.loadError')}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refetch()}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[0.85em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {t('common.retry')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/books')}
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2 text-[0.85em] font-medium text-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('books.record.back')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <style>{`
        @keyframes recPulse {0%,100%{box-shadow:0 0 0 0 color-mix(in srgb, var(--warning) 32%, transparent)}50%{box-shadow:0 0 0 8px transparent}}
        @keyframes recDash {to{background-position:0 15px}}
        .rec-live-node{animation:recPulse 1.9s ease-in-out infinite}
        .rec-live-rail{background-image:repeating-linear-gradient(180deg,var(--warning) 0 6px,transparent 6px 13px);background-size:2px 15px;animation:recDash 1.05s linear infinite}
        @media (prefers-reduced-motion:reduce){.rec-live-node,.rec-live-rail{animation:none}}
      `}</style>

      {/* header */}
      <header className="flex items-center gap-3.5 border-b border-hairline bg-gradient-to-b from-surface to-surface-tinted/40 px-5 py-3.5">
        <button
          type="button"
          onClick={() => navigate('/books')}
          aria-label={t('books.record.back')}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-hairline bg-surface text-primary transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" strokeWidth={2.2} />
        </button>
        <div className="min-w-0">
          <div className="font-mono text-[0.72em] font-semibold tracking-wide text-primary">
            {book?.ref_number ?? '—'}
          </div>
          <h1 className="truncate text-[1.05em] font-bold tracking-tight text-foreground">
            {book?.subject ?? (isPending ? t('books.record.loading') : t('books.record.untitled'))}
          </h1>
          <div className="mt-0.5 text-[0.72em] text-muted-foreground">
            {t('books.record.submittedBy')}{' '}
            <span className="font-semibold text-foreground">{submitter}</span>
            {book?.submitted_by_g && (
              <>
                {' · '}
                <span className="font-mono text-primary">{book.submitted_by_g}</span>
              </>
            )}
          </div>
        </div>
        <div className="ms-1">
          {book && (
            <StatePill state={state} signingPath={book.signing_path} signedSource={signedSource} />
          )}
        </div>
        <div className="ms-auto flex items-center gap-2">
          <HeaderBtn
            icon={<Printer className="h-3.5 w-3.5" />}
            label={t('books.record.print')}
            onClick={() => window.print()}
          />

          {action === 'decide' && (
            <>
              <HeaderBtn
                icon={<CornerUpLeft className="h-3.5 w-3.5" />}
                label={t('books.approval.return')}
                tone="amber"
                disabled={busy}
                onClick={() => {
                  setReason('')
                  setDecision('return')
                }}
              />
              <HeaderBtn
                icon={<X className="h-3.5 w-3.5" strokeWidth={2.4} />}
                label={t('books.approval.reject')}
                tone="red"
                disabled={busy}
                onClick={() => {
                  setReason('')
                  setDecision('reject')
                }}
              />
              <HeaderBtn
                icon={<PenLine className="h-3.5 w-3.5" />}
                label={t('books.approval.signApprove')}
                tone="green-solid"
                disabled={busy}
                onClick={() => signMutation.mutate()}
              />
            </>
          )}

          {action === 'review' && book && (
            <div data-testid="record-reviewer-actions">
              <ReviewerActions bookId={book.id} onDone={() => navigate('/books')} />
            </div>
          )}

          {action === 'submit' && (
            <HeaderBtn
              icon={<Send className="h-3.5 w-3.5" />}
              label={t('books.approval.submitForApproval')}
              tone="navy-solid"
              onClick={() => setSubmitOpen(true)}
            />
          )}

          {action === 'revise' && (
            <HeaderBtn
              icon={<CornerUpLeft className="h-3.5 w-3.5 -scale-x-100" />}
              label={t('books.versions.revise')}
              tone="navy-solid"
              disabled={!canRevise}
              onClick={handleRevise}
            />
          )}

          {state === 'approved' && current?.signed_pdf_url && (
            <a
              href={current.signed_pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-transparent bg-primary px-3 text-[0.78em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
              {t('books.record.downloadSigned')}
            </a>
          )}
        </div>
      </header>

      {/* override banner: approver sees that reviewers requested changes */}
      {action === 'decide' && changesRequestedCount(currentSteps) > 0 && (
        <div
          className="border-b border-warning/30 bg-warning/10 px-5 py-2.5 text-[0.78em] text-warning"
          data-testid="override-banner"
        >
          {t('books.reviewers.overrideBanner', { count: changesRequestedCount(currentSteps) })}
        </div>
      )}

      {/* inline reason panel for return / reject */}
      {decision && (
        <div className="border-b border-hairline bg-surface px-5 py-3.5">
          <label
            htmlFor="rec-reason"
            className="mb-1.5 block text-[0.78em] font-semibold text-foreground"
          >
            {decision === 'return'
              ? t('books.approval.return')
              : t('books.approval.reject')}{' '}
            · {t('books.approval.reasonLabel')}
          </label>
          <textarea
            id="rec-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('books.approval.reasonPlaceholder')}
            dir="auto"
            className="w-full rounded-lg border border-hairline bg-background px-3 py-2 text-[0.88em] text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          <div className="mt-2 flex items-center justify-end gap-2.5">
            {!reasonValid && (
              <span className="me-auto text-[0.74em] text-muted-foreground">
                {t('books.approval.reasonOrMark')}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setDecision(null)
                setReason('')
              }}
              className="rounded-lg border border-hairline px-3 py-1.5 text-[0.8em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('books.approval.cancelDecision')}
            </button>
            <button
              type="button"
              disabled={!reasonValid || busy}
              onClick={() => decideMutation.mutate({ act: decision, note: reason.trim() })}
              className={cn(
                'rounded-lg border border-transparent px-4 py-1.5 text-[0.8em] font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                decision === 'return' ? 'bg-warning hover:bg-warning/90' : 'bg-accent hover:bg-accent/90',
              )}
            >
              {decision === 'return' ? t('books.approval.return') : t('books.approval.reject')}
            </button>
          </div>
        </div>
      )}

      {/* body: desk + vertical timeline.
          `direction:ltr` pins the layout physically (desk left, Progress right) so
          the Progress rail does NOT flip sides in Arabic — a deliberate exception
          to the app's logical-direction convention. Text inside each column still
          reads per language (the aside re-asserts dir below). */}
      <div className="flex min-h-0 flex-1" style={{ direction: 'ltr' }}>
        {/* desk */}
        <div
          className="flex flex-1 justify-center overflow-auto px-6 py-7"
          style={{
            background:
              'radial-gradient(150% 100% at 40% -10%, var(--surface) 0%, var(--surface-tinted) 70%, var(--bg) 100%)',
          }}
        >
          <div className="relative w-full max-w-[640px]">
            {pdfUrl ? (
              <Suspense fallback={<DeskLoading />}>
                <DocPdfCanvas
                  pdfUrl={pdfUrl}
                  renderOverlay={
                    annotatable
                      ? (pages) => (
                          <BookAnnotationLayer
                            pages={pages}
                            annotations={annotations}
                            mode={annMode}
                            currentUserId={user?.id}
                            busy={createMark.isPending || deleteMark.isPending}
                            onCreate={(m) => createMark.mutate(m)}
                            onDelete={(id) => deleteMark.mutate(id)}
                          />
                        )
                      : undefined
                  }
                />
              </Suspense>
            ) : (
              <div className="flex h-full min-h-[400px] items-center justify-center text-[0.85em] text-muted-foreground">
                {isPending ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  t('books.record.noDocument')
                )}
              </div>
            )}
          </div>
        </div>

        {/* vertical progress timeline */}
        <aside
          dir={isAr ? 'rtl' : 'ltr'}
          className="hidden w-[236px] shrink-0 overflow-auto border-s border-hairline bg-surface px-5 py-6 md:block"
        >
          <h2 className="mb-5 text-[0.66em] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {t('books.record.progress')}
          </h2>
          <ol>
            {stations.map((s, i) => {
              const last = i === stations.length - 1
              const tone = TONE[s.tone]
              return (
                <li key={s.key} className="flex gap-3" style={{ opacity: s.state === 'done' ? 0.5 : s.state === 'future' ? 0.42 : 1 }}>
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        'flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border-[3px] border-surface',
                        s.state === 'live' && 'rec-live-node',
                      )}
                      style={
                        s.state === 'future'
                          ? { background: 'var(--surface)', color: 'var(--text-faint)', borderStyle: 'dashed', borderColor: 'var(--hairline)' }
                          : { background: tone.bg, color: tone.fg }
                      }
                      aria-hidden
                    >
                      {s.icon}
                    </span>
                    {!last && (
                      <span
                        className={cn('my-1 w-0.5 flex-1', s.state === 'live' ? 'rec-live-rail' : '')}
                        style={s.state === 'live' ? undefined : { background: 'var(--hairline)', minHeight: 22 }}
                      />
                    )}
                  </div>
                  <div className="pb-5">
                    <div className="text-[0.82em] font-bold" style={{ color: s.state === 'live' ? tone.fg : undefined }}>
                      {s.label}
                    </div>
                    <div className="mt-0.5 text-[0.7em] text-muted-foreground">{s.meta}</div>
                    {s.note && (
                      <div
                        className="mt-1.5 rounded-md px-2 py-1 text-[0.7em]"
                        style={{ background: tone.bg, color: tone.fg }}
                      >
                        “{s.note}”
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
          {/* Reviewer rows — advisory chain, below the approver timeline */}
          <ReviewerList reviewers={reviewerSteps(currentSteps)} />
        </aside>
      </div>

      {submitOpen && book && (
        <SubmitForApprovalDialog bookId={book.id} onClose={() => setSubmitOpen(false)} />
      )}
    </div>
  )
}

function DeskLoading(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-[400px] items-center justify-center text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  )
}

type BtnTone = 'plain' | 'amber' | 'red' | 'green-solid' | 'navy-solid'
function HeaderBtn({
  icon,
  label,
  tone = 'plain',
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  tone?: BtnTone
  onClick?: () => void
  disabled?: boolean
}): React.JSX.Element {
  const styles: Record<BtnTone, string> = {
    plain: 'border-hairline bg-surface text-primary hover:bg-surface-tinted',
    amber: 'border-warning/40 bg-surface text-warning hover:bg-warning/10',
    red: 'border-accent/40 bg-surface text-accent hover:bg-accent/10',
    'green-solid': 'border-transparent bg-success text-white hover:bg-success/90',
    'navy-solid': 'border-transparent bg-primary text-primary-foreground hover:bg-primary-hover',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[0.78em] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        styles[tone],
      )}
    >
      {icon}
      {label}
    </button>
  )
}

export default BookRecordPage
