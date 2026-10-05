/**
 * BookRecordPage — full-page record screen (Slice 2 of the signing redesign).
 *
 * Full-page route (`/books/:id`): the document large on a "desk" (left), a
 * vertical progress timeline pinned to the PHYSICAL right (both LTR + RTL), a
 * header with submitter identity + Print + state-driven actions. Reuses
 * DocPdfCanvas (multi-page, IDM-safe). Owns the action logic
 * (sign / decide-with-reason / revise / submit + query invalidation) and hands
 * it to the record/ pieces (header, desk, rail, dock) via `RecordActions`.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Check,
  ChevronRight,
  CornerUpLeft,
  PenLine,
  Printer,
  Send,
  Upload,
  X,
} from 'lucide-react'

import {
  api,
  ApiError,
  apiErrorMessage,
  type BookApprovalStepRead,
  type BookVersionRead,
  type BookAnnotationRead,
} from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { useCapabilities } from '@/lib/useCapabilities'
import { canFileSignedCopy, canSendForApproval, footerActionFor, inmateReporterActionFor } from '@/components/books/book-detail-drawer-utils'
import { changesRequestedCount, isApproverAssignee, myPendingReviewerStep } from '@/components/books/reviewers'
import { SubmitForApprovalDialog } from '@/components/books/SubmitForApprovalDialog'
import { RecordStateOverrideDialog } from '@/components/books/RecordStateOverrideDialog'
import { RevisionAccessPanel } from '@/components/books/RevisionAccessPanel'
import { useBookApprovalActions } from '@/components/books/useBookApprovalActions'
import { useInmateReportSubmit } from '@/components/books/useInmateReportSubmit'
import { hasCommentBearingMark } from '@/components/books/annotation-utils'
import { bidi } from '@/lib/bidi'
import { useUrlOverlay } from '@/lib/urlState'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { RECEIVED_STATUSES, SENT_STATUSES, approvalRecordUrl, isApprovalScope } from '@/lib/approvals'
import type { ApprovalContext, ApprovalKind, ApprovalSort, ApprovalStatus } from '@/lib/approvals'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { WordReopenTrigger } from '@/components/books/BookWordActions'
import type { AdjustSignatureTrigger } from '@/components/signature/AdjustSignatureAction'
import { IncludedPapersDialog } from './IncludedPapersDialog'
import { RecordChromeProvider, useRecordChrome } from './record/RecordChrome'
import { isIncludedPapersOwner } from './includedPapersState'
import { describeListFrom, useRecordNavContext } from './useRecordNavContext'
import { buildRecordBasketItem } from './recordsBasket'
import { buildBasketPrefill } from '@/lib/basketEmail'
import { getRecentRecipientsForForm } from '@/lib/recentRecipients'
import { basketKey } from '@/lib/emailBasket'

import { useIsMobile } from '@/lib/useIsMobile'
import { signedSourceOf } from './bookStateLabel'
import { useAddScan } from './useAddScan'
import { useManagePaper } from './useManagePaper'
import { paperUrl, type Paper } from './recordPapers'
import { useRecordPrintMode, useRecordPrintShortcut } from './useRecordPrintMode'
import { serviceHref } from '@/lib/quickActions'
import { copyToClipboard } from '@/lib/clipboard'
import { useShortcutAction } from '@/lib/useKeyboardShortcuts'
import { RecordHeader } from './record/RecordHeader'
import { RecordDesk, DecisionReasonForm } from './record/RecordDesk'
import { RecordDock } from './record/RecordDock'
import { RecordPhoneProgress, RecordRail, type Station } from './record/RecordRail'
import type { MarkInput, RecordActions, RecordCaps, RecordView } from './record/recordActions'
import { recordNextStep } from './recordNextStep'
import { deleteBlockReason } from './recordDelete'
import { useRecordDelete } from './RecordDeleteProvider'

type TFn = (key: string, opts?: Record<string, unknown>) => string



/** Read the originating approvals-queue context off the URL a queue row (or
 *  neighbor arrow) built with `approvalRecordUrl` — trusted format, not
 *  re-authorized here: the worklist queries this backs 403/empty on their own
 *  if the context turns out unauthorized. Absent/malformed params mean this
 *  record was opened without queue context (direct link, basket, etc.) —
 *  QueueNav simply renders nothing then. */
function parseApprovalContext(params: URLSearchParams): ApprovalContext | null {
  const tab = params.get('tab')
  if (!isApprovalScope(tab)) return null
  const sort: ApprovalSort = params.get('sort') === 'oldest' ? 'oldest' : 'newest'
  const pageRaw = Number.parseInt(params.get('page') ?? '', 10)
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1
  if (tab === 'sent') {
    const status = params.get('status')
    return {
      tab: 'sent',
      status: (SENT_STATUSES as readonly string[]).includes(status ?? '')
        ? (status as ApprovalStatus)
        : 'all',
      sort,
      page,
    }
  }
  const kindRaw = params.get('kind')
  const kind: ApprovalKind = kindRaw === 'review' ? 'review' : 'sign'
  const status = params.get('status')
  return {
    tab: 'received',
    kind,
    status: (RECEIVED_STATUSES as readonly string[]).includes(status ?? '')
      ? (status as ApprovalStatus)
      : 'pending',
    sort,
    page,
  }
}

/** Derive the "life of the document" from versions + approval state.
 * `signedSource` nuances the terminal stations: a scan-path book waits at the
 * printer (awaiting_scan), and a scan-back approval reads "Signed · scanned". */
function buildTimeline(
  versions: BookVersionRead[],
  approvalState: string,
  creator: string,
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
        label: t('books.record.stationCreated'),
        meta: `${creator} · v1 · ${v.created_at.slice(0, 10)}`,
        state: 'done',
        tone: 'navy',
      })
    } else {
      out.push({
        key: `rev-${v.id}`,
        icon: <CornerUpLeft className="h-[15px] w-[15px] -scale-x-100" strokeWidth={2} />,
        label: t('books.record.stationRevised'),
        meta: `${v.created_by_name ?? creator} · v${v.version_no}`,
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



/** The page owns the record chrome (rail / focus / full-screen) so the header and
 *  the desk read one state. */
export function BookRecordPage(): React.JSX.Element {
  return (
    <RecordChromeProvider>
      <BookRecordPageBody />
    </RecordChromeProvider>
  )
}

// Synthetic "signed" paper so the shared manage hook can route replace/unfile.
const SIGNED_PAPER: Paper = {
  kind: 'signed',
  url: '',
  downloadUrl: '',
  filename: '',
  isPdf: true,
}

function BookRecordPageBody(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const isMobile = useIsMobile()
  const bookId = Number(id)
  const onPdfReady = useRecordPrintMode()
  useRecordPrintShortcut()
  const chrome = useRecordChrome()
  const { scheduleDelete } = useRecordDelete()
  const [deleteOpen, setDeleteOpen] = useState(false)

  const versionIdParam = (() => {
    const raw = Number.parseInt(searchParams.get('version_id') ?? '', 10)
    return Number.isInteger(raw) && raw > 0 ? raw : undefined
  })()
  // The originating approvals-queue context (tab/kind/status/sort/page), if
  // this record was opened from a queue row or a neighbor arrow — drives
  // QueueNav's scoped prev/next and carries back into "return to queue" links.
  const approvalContext = useMemo(() => parseApprovalContext(searchParams), [searchParams])

  const qc = useQueryClient()
  const { user } = useAuth()
  const isInmateReporter = user?.role === 'inmate_reporter'
  const effectiveVersionId = isInmateReporter ? undefined : versionIdParam
  const effectiveApprovalContext = isInmateReporter ? null : approvalContext
  const { has, isLoading: capabilitiesLoading } = useCapabilities()
  const canApprove = has('books.approve')
  const canEdit = has('books.edit')
  const canSubmitBook = has('books.submit')
  // Filing a physically-signed scan back uses the same gate as the Records
  // pane's ＋Add-scan (books.edit + documents.scan).
  const canScan = has('documents.scan')
  // Revise regenerates via POST /documents/generate, which requires this cap;
  // without it the committed Save would 403.
  const canGenerate = has('documents.generate')
  // Admin-grade: rewrite the record's state outside the approval flow.
  const canOverrideState = has('books.override_state')
  const canManageRevisionAccess = has('users.manage')
  const overlay = useUrlOverlay('action', ['decision'])

  const fileSignedRef = useRef<HTMLInputElement | null>(null)
  const replaceSignedRef = useRef<HTMLInputElement | null>(null)
  const [unfileOpen, setUnfileOpen] = useState(false)
  // Inline reason panel for return/reject (backend requires a non-empty reason).
  const [reason, setReason] = useState('')
  const decisionPanelRef = useRef<HTMLDivElement | null>(null)
  const decisionReasonRef = useRef<HTMLTextAreaElement | null>(null)
  const panelReturnButtonRef = useRef<HTMLButtonElement | null>(null)
  const panelRejectButtonRef = useRef<HTMLButtonElement | null>(null)
  const [dockHidden, setDockHidden] = useState(false)

  // Reopen-in-Word and adjust-signature live in the Tools dropdown, but the
  // components that own their mutation/dialog/eligibility-query stay mounted
  // here (outside the dropdown's conditionally-mounted content) — see the
  // `hideTrigger`/`onTriggerChange` doc on each. These hold the reactive
  // trigger affordance the dropdown renders as a menu item.
  const [wordReopenTrigger, setWordReopenTrigger] = useState<WordReopenTrigger | null>(null)
  const [adjustSigTrigger, setAdjustSigTrigger] = useState<AdjustSignatureTrigger | null>(null)

  // Unified sign-confirmation (§3): every page sign control requests through
  // this instead of calling `signMutation.mutate()` directly. Captures the
  // record/version the confirmation was requested for, so a stale confirm
  // (queue navigation, a new version, someone else already deciding it) can
  // never fire.
  const desktopSignRef = useRef<HTMLButtonElement>(null)
  const mobileInlineSignRef = useRef<HTMLButtonElement>(null)
  const mobileDockSignRef = useRef<HTMLButtonElement>(null)
  const lastSignTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [signConfirm, setSignConfirm] = useState<{
    bookId: number
    versionId: number
    ref: string
    subject: string
    versionNo: number
  } | null>(null)

  const { data: book, isPending, isError, error, refetch } = useQuery({
    queryKey: ['books', 'detail', bookId, effectiveVersionId ?? null],
    queryFn: () => api.getBook(bookId, effectiveVersionId),
    enabled: Number.isFinite(bookId),
  })
  const reporterSubmitMutation = useInmateReportSubmit({
    onSuccess: () => toast.success(t('books.approval.submitted')),
    onError: (err, message) => {
      if (err instanceof ApiError && err.code === 'INMATE_REPORT_INCOMPLETE') {
        toast.error(message, {
          action: {
            label: t('books.pane.continueDraft'),
            onClick: handleRevise,
          },
        })
      } else {
        toast.error(message)
      }
    },
  })

  const manage = useManagePaper(book?.id ?? null)

  const versions = useMemo(() => book?.versions ?? [], [book?.versions])
  const liveVersion = versions.length ? versions[versions.length - 1] : undefined
  // The server picks the exact readable/displayed revision — never blindly
  // the array's last entry, which would silently show the wrong content (or
  // one a restricted grant doesn't cover) for an explicit historical view.
  const current =
    (book?.selected_version_id != null
      ? versions.find((v) => v.id === book.selected_version_id)
      : undefined) ?? liveVersion
  const isFullAccess = book?.access_scope !== 'assigned_revision'
  const isLiveCurrentVersion =
    current != null && current.version_no === liveVersion?.version_no
  // Current-record mutation tools (Word, revise, scan-back, package
  // management, state override, notifications, …) require full access AND
  // the live revision — never a retained/assigned-revision grant, and never
  // an explicit older revision a full-access reader is browsing.
  const canMutateCurrent = isFullAccess && isLiveCurrentVersion
  // Prefer the generated document; fall back to a v3-imported record's PDF
  // (served from the employee vault) when the book has no generated version.
  // The download URL is identical before and after signing (the backend swaps
  // in the signed artifact once the version is locked), so append a `rev` marker
  // when a signed PDF exists — without it the canvas keeps showing the cached
  // unsigned bytes and the just-applied manager signature never appears on screen.
  const pdfUrl = current?.document_id
    ? paperUrl({ documentId: current.document_id, signed: !!current.signed_pdf_url })
    : (book?.imported_doc?.pdf_url ?? null)
  const canManageIncludedPapers =
    !isInmateReporter &&
    book !== undefined &&
    canMutateCurrent &&
    current?.document_id != null &&
    isIncludedPapersOwner(book, user?.id)

  const submitter = book?.submitted_by_name ?? '—'
  const creator = book?.created_by_name ?? t('books.record.creatorUnknown')
  const state = book?.approval_state ?? 'none'
  const signedSource = book ? signedSourceOf(book) : null

  // Admin "file the signed scan back" — available regardless of who the
  // assigned approver is, so an operator handling requests for others can
  // close out the paper flow (print → sign → scan) from the record page.
  const addScan = useAddScan(book?.id ?? null)
  const showFileSigned =
    !isInmateReporter &&
    canMutateCurrent &&
    canFileSignedCopy(state, { canEdit, canScan })
  // Approved + signed paper on file + edit rights: gates Replace / Unfile and
  // the Tools-menu sections that hold them.
  const canManageSignedPaper =
    state === 'approved' && Boolean(current?.signed_pdf_url) && canEdit && canMutateCurrent
  // "Send for approval" (digital route): submit a draft, or re-route a still
  // pending request to a different signing manager. Both routes are offered
  // side by side so the operator picks per request.
  const reporterAction = book ? inmateReporterActionFor(book, user?.id) : 'read-only'
  const isInmateReport =
    isInmateReporter &&
    book?.ref_number.startsWith('REPORT-') === true &&
    reporterAction !== 'read-only'
  const showSendForApproval =
    canMutateCurrent &&
    (isInmateReport
      ? state === 'none' && book?.edit_session?.state !== 'active'
      : isInmateReporter
        ? reporterAction === 'edit-submit'
        : canSendForApproval(state, { canSubmitBook }))

  const stations = useMemo(
    () =>
      book ? buildTimeline(versions, book.approval_state, creator, t, signedSource) : [],
    [book, versions, creator, t, signedSource],
  )

  // Assignee/footer derivation (with reviewer support).
  // Annotate as the api.ts alias (extra fields kind/seen_at/assignee_name are
  // optional, so the base nested step type is assignable) — the generated nested
  // approval_steps type lacks them until `gen:api` is run.
  const currentSteps: BookApprovalStepRead[] = current?.approval_steps ?? book?.approval_steps ?? []
  const isAssignee = isLiveCurrentVersion && isApproverAssignee(currentSteps, user?.id)
  const myReview = isLiveCurrentVersion ? myPendingReviewerStep(currentSteps, user?.id) : null
  const action = isInmateReporter
    ? reporterAction === 'correct-resubmit' && !isInmateReport
      ? 'revise'
      : 'none'
    : footerActionFor(state, {
        // Every mutation targets the live revision. Historical pending steps are
        // retained for context but end when a newer revision exists.
        canRevise: canEdit && canMutateCurrent,
        canSubmitBook: canSubmitBook && canMutateCurrent,
        canApprove,
        isAssignee,
        isReviewer: myReview != null,
      })

  const decision =
    overlay.value === 'decision'
      ? searchParams.get('decision') === 'reject'
        ? 'reject'
        : 'return'
      : null

  useEffect(() => {
    const value = overlay.value
    if (isPending || capabilitiesLoading || !book || !value) return
    const allowed =
      (value === 'submit' && !isInmateReporter && showSendForApproval) ||
      (value === 'papers' && canManageIncludedPapers) ||
      (value === 'revision-access' && !isInmateReporter && canManageRevisionAccess) ||
      (value === 'override' &&
        !isInmateReporter &&
        canOverrideState &&
        canMutateCurrent) ||
      (value === 'decision' && action === 'decide')
    if (!allowed) overlay.close()
  }, [
    action,
    book,
    canManageIncludedPapers,
    canManageRevisionAccess,
    canMutateCurrent,
    canOverrideState,
    capabilitiesLoading,
    isInmateReporter,
    isPending,
    overlay.value,
    overlay.close,
    showSendForApproval,
  ])

  useEffect(() => {
    if (isMobile && action === 'decide' && decisionPanelRef.current) {
      const observer = new IntersectionObserver(
        ([entry]) => setDockHidden(entry.intersectionRatio >= 0.4),
        { threshold: 0.4 },
      )
      observer.observe(decisionPanelRef.current)
      return () => observer.disconnect()
    }

    setDockHidden(false)
  }, [isMobile, action, bookId])

  // Seen-on-open: fire once when the current user has a step with no seen_at.
  const myStep = isLiveCurrentVersion
    ? currentSteps.find((s) => s.assignee_user_id === user?.id)
    : undefined
  useEffect(() => {
    if (!isInmateReporter && book && myStep && !myStep.seen_at) {
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
  // Marking is opt-in. It used to be forced on for the decider, which put a
  // pointer-eating overlay across the whole document — on a phone that killed
  // pinch-zoom and made an A4 page unreadable. Now the manager arms it.
  //
  // Arm is per-record, not a plain boolean: `/books/:id` doesn't remount when
  // the queue arrows change the id param, so a bare useState(false) would
  // carry a live overlay from one record onto the next unarmed paper.
  const [armedFor, setArmedFor] = useState<number | null>(null)
  const armed = armedFor === bookId
  const canMark = state === 'pending' && action === 'decide'
  const annMode: 'view' | 'mark' = canMark ? 'mark' : 'view'
  const {
    back,
    step,
    queue,
    from: backFrom,
  } = useRecordNavContext({
    bookId: Number.isFinite(bookId) ? bookId : null,
    versionId: current?.id ?? null,
    approvalContext: effectiveApprovalContext,
  })
  const backFilter = describeListFrom(backFrom, t)
  const backLabel = backFilter
    ? t('books.record.backFrom', { filter: backFilter })
    : t('books.record.back')
  const { data: annotations = [] } = useQuery({
    queryKey: ['books', 'annotations', bookId, current?.id],
    queryFn: () => api.listBookAnnotations(bookId, current!.id),
    enabled: annotatable && Number.isFinite(bookId) && current?.id != null,
  })

  const annotationsKey = ['books', 'annotations', bookId, current?.id] as const
  // Optimistic (StarButton idiom): the mark shows at once under a negative
  // placeholder id, rolls back on error, and the server copy replaces it on settle.
  const createMark = useMutation({
    mutationFn: (m: MarkInput) => api.createBookAnnotation(bookId, current!.id, m),
    onMutate: async (m) => {
      await qc.cancelQueries({ queryKey: annotationsKey })
      const prev = qc.getQueryData<BookAnnotationRead[]>(annotationsKey)
      const optimistic: BookAnnotationRead = {
        id: -Date.now(),
        version_id: current!.id,
        page: m.page,
        kind: m.kind,
        geometry: m.geometry,
        comment: m.comment,
        author_user_id: user?.id ?? null,
        author_name: null,
        created_at: new Date().toISOString(),
      }
      qc.setQueryData<BookAnnotationRead[]>(annotationsKey, [...(prev ?? []), optimistic])
      return { prev }
    },
    onError: (err, _m, ctx) => {
      qc.setQueryData<BookAnnotationRead[]>(annotationsKey, ctx?.prev ?? [])
      toast.error(apiErrorMessage(err))
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: annotationsKey }),
  })
  const deleteMark = useMutation({
    mutationFn: (annId: number) => api.deleteBookAnnotation(bookId, current!.id, annId),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['books', 'annotations', bookId, current?.id] }),
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  // "Review next waiting record" — populated only after a sign succeeds THIS
  // session (never on a cold load of an already-approved record).
  const [nextWaitingResult, setNextWaitingResult] = useState<{
    bookId: number
    next: { bookId: number; versionId: number | null; refNumber: string } | null
  } | null>(null)
  const nextWaiting =
    nextWaitingResult?.bookId === bookId ? nextWaitingResult.next : undefined

  const { decideMutation, signMutation } = useBookApprovalActions({
    bookId: book?.id,
    versionId: current?.id,
    onDecided: () => {
      overlay.close()
      setReason('')
      // Stay on the record after return/reject; the action hook's query
      // invalidation refreshes the record state in place.
    },
    // Stay on the record after signing: the refetch flips the state to
    // approved and reloads the signed PDF so the signer sees it land.
    onSigned: () => {
      const justSignedId = book?.id
      if (justSignedId == null) return
      void api
        .listApprovalLog({
          scope: 'received',
          kind: 'approver', status: 'pending', sort: effectiveApprovalContext?.sort ?? 'newest', limit: 2, offset: 0,
        })
        .then((res) => {
          const row = res.items.find((item) => item.book_id !== justSignedId)
          setNextWaitingResult({
            bookId: justSignedId,
            next: row
              ? { bookId: row.book_id, versionId: row.version_id ?? null, refNumber: row.ref_number }
              : null,
          })
        })
        .catch(() => setNextWaitingResult({ bookId: justSignedId, next: null }))
    },
  })

  const handleRevise = useCallback((): void => {
    if (!book || !current?.template_id) return
    navigate(`${serviceHref(current.template_id)}?revise=${book.id}`)
  }, [book, current, navigate])

  // "Email via Outlook" — the record's own handoff entry point. It builds the
  // SAME one-item basket prefill the tray builds (subject/body templates,
  // reference PDF, book link) and routes to /ledger, where the handoff dialog
  // consumes it. A record with no generated document has nothing to attach, so
  // the action stays disabled rather than producing an empty email.
  const recordHasPapers = current?.document_id != null
  const [emailingRecord, setEmailingRecord] = useState(false)

  const handleEmailViaOutlook = useCallback(async (): Promise<void> => {
    if (!book || !recordHasPapers || emailingRecord) return
    setEmailingRecord(true)
    try {
      const item = await buildRecordBasketItem(book)
      if (!item) {
        toast.error(t('basket.addError'))
        return
      }
      const key = basketKey(item)
      // Learned recipients are still keyed by form kind, so the To field is
      // seeded the same way a basket send would seed it. The key itself is then
      // dropped: this is not a basket send, and carrying it would let a
      // successful handoff clear a same-kind basket the operator is still
      // filling. Clear only the persisted-basket identity, not the prefill.
      const prefill = buildBasketPrefill([item], getRecentRecipientsForForm(key))
      prefill.basketKey = undefined
      navigate('/ledger', { state: { composePrefill: prefill } })
    } catch (err) {
      toast.error(apiErrorMessage(err))
    } finally {
      setEmailingRecord(false)
    }
  }, [book, recordHasPapers, emailingRecord, navigate, t])

  const busy = decideMutation.isPending || signMutation.isPending
  const canRevise = Boolean(
    current?.template_id &&
      current?.has_fields &&
      canGenerate &&
      canMutateCurrent &&
      (!isInmateReporter || reporterAction === 'correct-resubmit'),
  )
  const reasonValid = reason.trim().length > 0 || hasCommentBearingMark(annotations)
  const decisionReasonFormProps = {
    reason,
    reasonValid,
    busy,
    inputRef: decisionReasonRef,
    onReasonChange: setReason,
    onCancel: (act: 'return' | 'reject') => {
      overlay.close()
      setReason('')
      if (isMobile) {
        requestAnimationFrame(() => {
          const actionRef =
            act === 'return' ? panelReturnButtonRef : panelRejectButtonRef
          actionRef.current?.focus()
        })
      }
    },
    onConfirm: (act: 'return' | 'reject') =>
      decideMutation.mutate({ act, note: reason.trim() }),
  }

  const openMobileDecision = useCallback((nextDecision: 'return' | 'reject'): void => {
    setReason('')
    overlay.open('decision', { decision: nextDecision })
    requestAnimationFrame(() => {
      decisionPanelRef.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'end',
      })
      decisionReasonRef.current?.focus({ preventScroll: true })
    })
  }, [overlay.open])

  // Every page sign control (desktop header, mobile inline panel, mobile
  // dock) requests through here instead of calling `signMutation.mutate()`
  // directly — captures the record/version the confirmation is FOR, so a
  // stale confirm can't fire (see the render-time correction below and the
  // re-check in `confirmSign`).
  const requestSignConfirm = useCallback((triggerRef: React.RefObject<HTMLButtonElement | null>): void => {
    if (!book || !current || busy) return
    // Copy the element (not the ref object) outside render: `onOpenChange`
    // clears `signConfirm` synchronously on close, but Radix reads
    // `returnFocusRef` right after in the same close — a ref sourced from
    // already-null state would be undefined by then, so focus would fall
    // back to <body>. This ref is stable and never read during render.
    lastSignTriggerRef.current = triggerRef.current
    setSignConfirm({
      bookId: book.id,
      versionId: current.id,
      ref: book.ref_number,
      subject: book.subject ?? '',
      versionNo: current.version_no,
    })
  }, [book, current, busy, setSignConfirm])

  // Discard (never re-fire) the confirmation the instant the captured
  // record/version stops being the one on screen, or decide eligibility is
  // lost — queue navigation, a newer version landing, or someone else
  // deciding it first. A render-time correction (mirrors the `sessionBookId`
  // pattern in WordReopenButton) rather than an effect: it stabilizes after
  // one extra render since the condition is false again once cleared, with
  // no separate effect pass and no risk of a stale confirm painting first.
  if (
    signConfirm &&
    (signConfirm.bookId !== book?.id || signConfirm.versionId !== current?.id || action !== 'decide')
  ) {
    setSignConfirm(null)
  }

  function confirmSign(): void {
    if (!signConfirm) return
    const stillEligible =
      book?.id === signConfirm.bookId &&
      current?.id === signConfirm.versionId &&
      action === 'decide' &&
      !busy
    if (stillEligible) signMutation.mutate()
  }

  // The one "what is this record waiting for / what can I do" answer, shared by
  // the header, the dock and the Records pane (`recordNextStep`).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const locale = i18n.language
  const nextStep = useMemo(
    () =>
      book
        ? recordNextStep(book, {
            has,
            canEdit,
            canGenerate,
            canMutateCurrent,
            isInmateReporter,
            inmateAction: reporterAction,
            isAssignee,
            isReviewer: myReview != null,
            hasDocument: recordHasPapers,
            canManageIncludedPapers,
            now,
            locale,
          })
        : null,
    [
      book,
      has,
      canEdit,
      canGenerate,
      canMutateCurrent,
      isInmateReporter,
      reporterAction,
      isAssignee,
      myReview,
      recordHasPapers,
      canManageIncludedPapers,
      now,
      locale,
    ],
  )
  const pendingAct: RecordView['pendingAct'] = signMutation.isPending
    ? 'sign'
    : decideMutation.isPending
      ? decideMutation.variables?.act === 'reject'
        ? 'reject'
        : decideMutation.variables?.act === 'return'
          ? 'return'
          : null
      : null
  const deleteBlocked = book ? deleteBlockReason(book, { has, isInmateReporter }) : 'noCapability'

  const copyRef = useCallback((): void => {
    if (!book) return
    const refNumber = book.ref_number
    void copyToClipboard(refNumber).then((ok) => {
      if (ok) toast.success(t('books.record.copiedRef', { ref: bidi(refNumber) }))
      else toast.error(t('common.copyFailed'))
    })
  }, [book, t])

  const caps: RecordCaps = useMemo(
    () => ({
      has,
      canEdit,
      canMutateCurrent,
      isInmateReporter,
      isInmateReport,
      canOverrideState,
      canManageRevisionAccess,
      canManageIncludedPapers,
      canManageSignedPaper,
      canRevise,
      canMark,
      showSendForApproval,
      showFileSigned,
    }),
    [
      has,
      canEdit,
      canMutateCurrent,
      isInmateReporter,
      isInmateReport,
      canOverrideState,
      canManageRevisionAccess,
      canManageIncludedPapers,
      canManageSignedPaper,
      canRevise,
      canMark,
      showSendForApproval,
      showFileSigned,
    ],
  )

  // ── Record keys (bare keys; handlers decline with `false` when not applicable) ──
  const canDecideNow = nextStep?.decide === true && action === 'decide'
  const stepTo = useCallback(
    (id: number | null, versionId: number | null): boolean => {
      if (isInmateReporter || id == null) return false
      setArmedFor(null)
      step(id, versionId)
      return true
    },
    [isInmateReporter, step, setArmedFor],
  )
  useShortcutAction('recordNext', () => stepTo(queue.nextId, queue.nextVersionId))
  useShortcutAction('recordPrev', () => stepTo(queue.prevId, queue.prevVersionId))
  useShortcutAction('copyRef', () => {
    if (!book) return false
    copyRef()
  })
  useShortcutAction('signConfirm', () => {
    if (!canDecideNow || busy) return false
    requestSignConfirm(isMobile ? mobileDockSignRef : desktopSignRef)
  })
  useShortcutAction('toggleMark', () => {
    if (!canMark || !canDecideNow) return false
    setArmedFor(armed ? null : bookId)
  })
  // The ONE escape resolver of this page: rail drawer → full-screen viewer →
  // focus mode → Back. Radix overlays and editable targets never reach it.
  useShortcutAction('escape', () => {
    if (chrome.railDrawerOpen) {
      chrome.closeRailDrawer()
      return
    }
    if (chrome.fullscreen) {
      chrome.setFullscreen(false)
      return
    }
    if (chrome.focus) {
      chrome.setFocus(false)
      return
    }
    back()
  })

  // Tab title: "<ref> · <subject> — GSSG"; restored on unmount. Kept while
  // printing (`?print=1`): it is the saved-PDF filename, and manual Print
  // enters print mode on this very page.
  const titleRef = book?.ref_number
  const titleSubject = book?.subject
  useEffect(() => {
    if (!titleRef) return
    const previous = document.title
    document.title = `${titleRef} · ${titleSubject || t('books.record.untitled')} — GSSG`
    return () => {
      document.title = previous
    }
  }, [titleRef, titleSubject, t])

  const view: RecordView = {
    bookId,
    isMobile,
    isAr,
    isPending,
    state,
    action,
    decision,
    busy,
    submitter,
    signedSource,
    current,
    liveVersion,
    currentSteps,
    stations,
    pdfUrl,
    userId: user?.id,
    backLabel,
    queue,
    nextStep,
    pendingAct,
    creator,
    armed,
    annotatable,
    annMode,
    annotations,
    markBusy: createMark.isPending || deleteMark.isPending,
    dockHidden,
    recordHasPapers,
    emailingRecord,
    scanBusy: addScan.busy,
    wordReopenTrigger,
    adjustSigTrigger,
    decisionReasonFormProps,
  }

  // Built once per dependency change and handed to every record piece.
  const fileSignedCopy = addScan.fileSignedCopy
  const replacePaper = manage.replacePaper
  const reporterSubmit = reporterSubmitMutation.mutate
  const createMarkMutate = createMark.mutate
  const deleteMarkMutate = deleteMark.mutate
  const openOverlay = overlay.open
  const requestDelete = useCallback((): void => setDeleteOpen(true), [])
  const actions: RecordActions = useMemo(
    () => ({
      back,
      step,
      setArmedFor,
      setReason,
      openOverlay,
      handleRevise,
      requestSignConfirm,
      openMobileDecision,
      submitReport: reporterSubmit,
      emailViaOutlook: handleEmailViaOutlook,
      setUnfileOpen,
      fileSignedCopy: (file, ref) => fileSignedCopy(file, ref).then(() => void refetch()),
      replaceSignedPaper: (file) => replacePaper(SIGNED_PAPER, file),
      setWordReopenTrigger,
      setAdjustSigTrigger,
      createMark: createMarkMutate,
      // Optimistic marks carry a negative placeholder id until the server answers.
      deleteMark: (markId) => {
        if (markId > 0) deleteMarkMutate(markId)
      },
      onPdfReady,
      pickSignedFile: () => fileSignedRef.current?.click(),
      pickReplacementFile: () => replaceSignedRef.current?.click(),
      fileSignedRef,
      replaceSignedRef,
      desktopSignRef,
      mobileInlineSignRef,
      mobileDockSignRef,
      decisionPanelRef,
      panelReturnButtonRef,
      panelRejectButtonRef,
      requestDelete,
      copyRef,
    }),
    [
      back,
      step,
      setArmedFor,
      setReason,
      setUnfileOpen,
      setWordReopenTrigger,
      setAdjustSigTrigger,
      openOverlay,
      handleRevise,
      requestSignConfirm,
      openMobileDecision,
      reporterSubmit,
      handleEmailViaOutlook,
      fileSignedCopy,
      refetch,
      replacePaper,
      createMarkMutate,
      deleteMarkMutate,
      onPdfReady,
      requestDelete,
      copyRef,
    ],
  )

  // Banners yield the screen to the document in focus mode (desktop only).
  const hideBanners = chrome.focus && !isMobile

  if (!Number.isFinite(bookId) || (error instanceof ApiError && error.status === 404)) {
    return <NotFoundPage />
  }

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
            onClick={back}
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

      <RecordHeader book={book} caps={caps} view={view} actions={actions} />

      {book && pdfUrl && canManageIncludedPapers && (
        <IncludedPapersDialog
          open={overlay.value === 'papers' && !capabilitiesLoading}
          onOpenChange={(open) => { if (!open) overlay.close() }}
          book={book}
          currentPdfUrl={pdfUrl}
        />
      )}

      <ConfirmDialog
        open={unfileOpen}
        onOpenChange={setUnfileOpen}
        title={t('books.pane.unfileSignedTitle')}
        description={t('books.pane.unfileSignedBody')}
        confirmLabel={t('books.pane.unfileSignedConfirm')}
        destructive
        onConfirm={() => {
          setUnfileOpen(false)
          void manage.deletePaper(SIGNED_PAPER)
        }}
      />

      {/* Delete record / draft: confirm, then hide at once and commit after 6 s
          (Undo in the toast) while the reader returns to the list. */}
      <ConfirmDialog
        open={deleteOpen && deleteBlocked === null && book !== undefined}
        onOpenChange={setDeleteOpen}
        title={t('books.record.deleteTitle', { ref: bidi(book?.ref_number ?? '') })}
        description={t('books.record.deleteBody')}
        confirmLabel={state === 'none' ? t('books.record.deleteDraft') : t('books.record.delete')}
        destructive
        onConfirm={() => {
          if (!book || deleteBlocked !== null) return
          setDeleteOpen(false)
          scheduleDelete([{ id: book.id, ref: book.ref_number }])
          back()
        }}
      />

      {/* Unified sign confirmation (§3) — the desktop, mobile-inline, and
          mobile-dock sign controls all request through `requestSignConfirm`
          instead of mutating directly. */}
      <ConfirmDialog
        open={signConfirm != null}
        onOpenChange={(open) => {
          if (!open) setSignConfirm(null)
        }}
        title={t('books.approval.signConfirmTitle')}
        description={
          signConfirm
            ? t('books.approval.signConfirmBody', {
                // Isolate the LTR ref/subject runs so they can't scramble the
                // surrounding Arabic sentence (same `bidi()` idiom BookWordActions
                // uses for the same "ref token inside a plain translated string"
                // shape) — the description is plain text, no bidi-aware markup.
                ref: bidi(signConfirm.ref),
                version: signConfirm.versionNo,
                subject: bidi(signConfirm.subject),
              })
            : undefined
        }
        confirmLabel={t('books.approval.signApprove')}
        onConfirm={confirmSign}
        returnFocusRef={lastSignTriggerRef}
      />

      {/* Post-sign "what's next" — only after a sign succeeds THIS session. */}
      {state === 'approved' && nextWaiting !== undefined && !hideBanners && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline bg-success-soft/40 px-4 py-2.5 text-[0.8em] sm:px-5"
          data-print-hide
        >
          <span className="flex min-w-0 flex-1 items-center gap-2 font-semibold text-success">
            <Check className="h-4 w-4 shrink-0" strokeWidth={2.4} aria-hidden />
            {t('books.approval.signed')}
          </span>
          {nextWaiting ? (
            <button
              type="button"
              onClick={() =>
                navigate(
                  effectiveApprovalContext
                    ? approvalRecordUrl(
                        nextWaiting.bookId,
                        nextWaiting.versionId,
                        effectiveApprovalContext,
                      )
                    : `/books/${nextWaiting.bookId}`,
                )
              }
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[0.95em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:min-h-9"
            >
              {t('books.record.reviewNext', { ref: bidi(nextWaiting.refNumber) })}
              <ChevronRight className="h-4 w-4 rtl:-scale-x-100" strokeWidth={2.2} aria-hidden />
            </button>
          ) : (
            <span className="text-muted-foreground">{t('books.approval.noSignaturesWaiting')}</span>
          )}
        </div>
      )}

      {/* override banner: approver sees that reviewers requested changes */}
      {action === 'decide' && !hideBanners && changesRequestedCount(currentSteps) > 0 && (
        <div
          className="border-b border-warning/30 bg-warning/10 px-5 py-2.5 text-[0.78em] text-warning"
          data-testid="override-banner"
          data-print-hide
        >
          {t('books.reviewers.overrideBanner', { count: changesRequestedCount(currentSteps) })}
        </div>
      )}

      {/* inline reason panel for return / reject */}
      {decision && !isMobile && (
        <div className="border-b border-hairline bg-surface px-5 py-3.5" data-print-hide>
          <DecisionReasonForm {...decisionReasonFormProps} act={decision} />
        </div>
      )}

      <RecordPhoneProgress book={book} view={view} />

      {/* body: desk + vertical timeline.
          `direction:ltr` pins the layout physically (desk left, Progress right) so
          the Progress rail does NOT flip sides in Arabic — a deliberate exception
          to the app's logical-direction convention. Text inside each column still
          reads per language (the aside re-asserts dir below). */}
      <div className="flex min-h-0 flex-1" style={{ direction: 'ltr' }}>
        {/* desk */}
        <RecordDesk book={book} caps={caps} view={view} actions={actions} />

        <RecordRail book={book} view={view} />
      </div>

      <RecordDock book={book} caps={caps} view={view} actions={actions} />

      {!isInmateReporter && overlay.value === 'submit' && book && showSendForApproval && !isPending && !capabilitiesLoading && (
        <SubmitForApprovalDialog bookId={book.id} onClose={overlay.close} />
      )}

      {!isInmateReporter && overlay.value === 'override' && book && canOverrideState && canMutateCurrent && !isPending && !capabilitiesLoading && (
        <RecordStateOverrideDialog book={book} onClose={overlay.close} />
      )}

      {!isInmateReporter && overlay.value === 'revision-access' && book && canManageRevisionAccess && !isPending && !capabilitiesLoading && (
        <RevisionAccessPanel bookId={book.id} onClose={overlay.close} />
      )}
    </div>
  )
}


export default BookRecordPage
