/**
 * BookRecordPage — full-page record screen (Slice 2 of the signing redesign).
 *
 * Full-page route (`/books/:id`): the document large on a "desk" (left), a
 * vertical progress timeline pinned to the PHYSICAL right (both LTR + RTL), a
 * header with submitter identity + Print + state-driven actions. Reuses
 * DocPdfCanvas (multi-page, IDM-safe). Action logic mirrors BookDetailDrawer
 * (sign / decide-with-reason / revise / submit + query invalidation).
 */

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  CornerUpLeft,
  FileText,
  FileStack,
  Loader2,
  Mail,
  PenLine,
  Printer,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  Wrench,
  X,
} from 'lucide-react'

import {
  api,
  ApiError,
  apiErrorMessage,
  type BookApprovalStepRead,
  type BookVersionRead,
  type NotifyMessageRead,
} from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { useCapabilities } from '@/lib/useCapabilities'
import {
  canFileSignedCopy,
  canSendForApproval,
  footerActionFor,
  inmateReporterActionFor,
} from '@/components/books/book-detail-drawer-utils'
import {
  changesRequestedCount,
  isApproverAssignee,
  myPendingReviewerStep,
  reviewerSteps,
} from '@/components/books/reviewers'
import { ReviewerList } from '@/components/books/ReviewerList'
import { ReviewerActions } from '@/components/books/ReviewerActions'
import { SubmitForApprovalDialog } from '@/components/books/SubmitForApprovalDialog'
import { RecordStateOverrideDialog } from '@/components/books/RecordStateOverrideDialog'
import { RevisionAccessPanel } from '@/components/books/RevisionAccessPanel'
import { BookAnnotationLayer } from '@/components/books/BookAnnotationLayer'
import { useBookApprovalActions } from '@/components/books/useBookApprovalActions'
import { hasCommentBearingMark } from '@/components/books/annotation-utils'
import { bidi } from '@/lib/bidi'
import { cn } from '@/lib/utils'
import {
  RECEIVED_STATUSES,
  SENT_STATUSES,
  approvalRecordUrl,
  isApprovalScope,
} from '@/lib/approvals'
import type { ApprovalContext, ApprovalKind, ApprovalSort, ApprovalStatus } from '@/lib/approvals'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BookStatusChips } from '@/components/books/BookStatusChips'
import {
  WordReopenButton,
  WordSessionActions,
  type WordReopenTrigger,
} from '@/components/books/BookWordActions'
import {
  AdjustSignatureAction,
  type AdjustSignatureTrigger,
} from '@/components/signature/AdjustSignatureAction'
import { IncludedPapersDialog } from './IncludedPapersDialog'
import { QueueNav } from './QueueNav'
import { MarkToggle } from './MarkToggle'
import { RecordDecisionActions } from './RecordDecisionActions'
import { isIncludedPapersOwner } from './includedPapersState'
import { HeaderBtn } from './HeaderBtn'
import { useAwaitingQueue } from './useAwaitingQueue'
import { buildRecordBasketItem } from './recordsBasket'
import { buildBasketPrefill } from '@/lib/basketEmail'
import { getRecentRecipientsForForm } from '@/lib/recentRecipients'
import { basketKey } from '@/lib/emailBasket'

import { useIsMobile } from '@/lib/useIsMobile'
import { smsDeliveryTone } from '@/lib/smsDelivery'
import { sealDescriptor, signedSourceOf, type SealTone } from './bookStateLabel'
import { useAddScan } from './useAddScan'
import { useManagePaper } from './useManagePaper'
import type { Paper } from './recordPapers'
import { useRecordPrintMode } from './useRecordPrintMode'

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


/** Read the originating approvals-queue context off the URL a queue row (or
 *  neighbor arrow) built with `approvalRecordUrl` — trusted format, not
 *  re-authorized here: the worklist queries this backs 403/empty on their own
 *  if the context turns out unauthorized. Absent/malformed params mean this
 *  record was opened without queue context (direct link, basket, etc.) —
 *  QueueNav simply renders nothing then. */
function parseApprovalContext(params: URLSearchParams): ApprovalContext | null {
  const tab = params.get('tab')
  if (!isApprovalScope(tab)) return null
  const sort: ApprovalSort = params.get('sort') === 'newest' ? 'newest' : 'oldest'
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
        label: t('books.record.stationCreated'),
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

/** The station that best summarizes "where this record is right now" — for
 *  `pending`/`awaiting_scan` the array's last entry is a `future` placeholder
 *  (e.g. "Signed" ahead of the still-live "Awaiting signature"), so summarizing
 *  from the raw last entry would show the wrong step. Prefer the live station;
 *  fall back to the latest completed one for a terminal state with no live
 *  station (`returned`/`rejected`) — never blindly the last array entry. */
function currentSummaryStation(stations: Station[]): Station | undefined {
  return (
    stations.find((s) => s.state === 'live') ??
    [...stations].reverse().find((s) => s.state === 'done')
  )
}

/** Shared render of the progress timeline + reviewer list + SMS notifications —
 *  used by both the desktop sidebar and the mobile expandable status section so
 *  the two surfaces can never drift apart. */
function RecordTimelineContent({
  stations,
  currentSteps,
  currentVersionNo,
  liveVersionNo,
  sms,
}: {
  stations: Station[]
  currentSteps: BookApprovalStepRead[]
  currentVersionNo?: number
  liveVersionNo?: number
  sms?: NotifyMessageRead[] | null
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <h2 className="mb-5 text-[0.66em] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {t('books.record.progress')}
      </h2>
      <ol>
        {stations.map((s, i) => {
          const last = i === stations.length - 1
          const tone = TONE[s.tone]
          return (
            <li
              key={s.key}
              aria-current={s.state === 'live' ? 'step' : undefined}
              className="flex gap-3"
              style={{ opacity: s.state === 'done' ? 0.5 : s.state === 'future' ? 0.42 : 1 }}
            >
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
      <ReviewerList
        reviewers={reviewerSteps(currentSteps)}
        versionNo={currentVersionNo}
        currentVersionNo={liveVersionNo}
      />

      {/* Notification block — SMS sent for this record */}
      {sms && sms.length > 0 && <NotificationBlock messages={sms} />}
    </>
  )
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

interface DecisionReasonFormProps {
  act: 'return' | 'reject'
  reason: string
  reasonValid: boolean
  busy: boolean
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  onReasonChange: (reason: string) => void
  onCancel: (act: 'return' | 'reject') => void
  onConfirm: (act: 'return' | 'reject') => void
}

function DecisionReasonForm({
  act,
  reason,
  reasonValid,
  busy,
  inputRef,
  onReasonChange,
  onCancel,
  onConfirm,
}: DecisionReasonFormProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <label
        htmlFor="rec-reason"
        className="mb-1.5 block text-[0.78em] font-semibold text-foreground"
      >
        {act === 'return'
          ? t('books.approval.return')
          : t('books.approval.reject')}{' '}
        · {t('books.approval.reasonLabel')}
      </label>
      <textarea
        ref={inputRef}
        id="rec-reason"
        rows={2}
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
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
          onClick={() => onCancel(act)}
          className="rounded-lg border border-hairline px-3 py-1.5 text-[0.8em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('books.approval.cancelDecision')}
        </button>
        <button
          type="button"
          disabled={!reasonValid || busy}
          onClick={() => onConfirm(act)}
          className={cn(
            'rounded-lg border border-transparent px-4 py-1.5 text-[0.8em] font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
            act === 'return' ? 'bg-warning hover:bg-warning/90' : 'bg-accent hover:bg-accent/90',
          )}
        >
          {act === 'return' ? t('books.approval.return') : t('books.approval.reject')}
        </button>
      </div>
    </>
  )
}

export function BookRecordPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const isMobile = useIsMobile()
  const bookId = Number(id)
  const onPdfReady = useRecordPrintMode()

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
  const { has } = useCapabilities()
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

  const fileSignedRef = useRef<HTMLInputElement | null>(null)
  const replaceSignedRef = useRef<HTMLInputElement | null>(null)
  const [unfileOpen, setUnfileOpen] = useState(false)
  const [includedPapersOpen, setIncludedPapersOpen] = useState(false)
  const [revisionAccessOpen, setRevisionAccessOpen] = useState(false)

  const [submitOpen, setSubmitOpen] = useState(false)
  const [stateOverrideOpen, setStateOverrideOpen] = useState(false)
  // Inline reason panel for return/reject (backend requires a non-empty reason).
  const [decision, setDecision] = useState<'return' | 'reject' | null>(null)
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

  const { data: book, isPending, isError, refetch } = useQuery({
    queryKey: ['books', 'detail', bookId, effectiveVersionId ?? null],
    queryFn: () => api.getBook(bookId, effectiveVersionId),
    enabled: Number.isFinite(bookId),
  })
  const reporterSubmitMutation = useMutation({
    mutationFn: () =>
      api.submitBook(bookId, {
        priority: 'Normal',
        approver_user_id: null,
        reviewer_user_ids: [],
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(t('books.approval.submitted'))
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'INMATE_REPORT_INCOMPLETE') {
        toast.error(apiErrorMessage(err), {
          action: {
            label: t('books.pane.continueDraft'),
            onClick: handleRevise,
          },
        })
      } else {
        toast.error(apiErrorMessage(err))
      }
    },
  })

  const manage = useManagePaper(book?.id ?? null)
  // Synthetic "signed" paper so the shared manage hook can route replace/unfile.
  const signedPaper: Paper = {
    kind: 'signed',
    url: '',
    downloadUrl: '',
    filename: '',
    isPdf: true,
  }

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
    ? `/api/v1/documents/${current.document_id}/download?format=pdf${
        current.signed_pdf_url ? '&rev=signed' : ''
      }`
    : (book?.imported_doc?.pdf_url ?? null)
  const canManageIncludedPapers =
    !isInmateReporter &&
    book !== undefined &&
    canMutateCurrent &&
    current?.document_id != null &&
    isIncludedPapersOwner(book, user?.id)

  const submitter = book?.submitted_by_name ?? '—'
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
  const showSendForApproval =
    canMutateCurrent &&
    (isInmateReporter
      ? reporterAction === 'edit-submit'
      : canSendForApproval(state, { canSubmitBook }))

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
  const isAssignee = isLiveCurrentVersion && isApproverAssignee(currentSteps, user?.id)
  const myReview = isLiveCurrentVersion ? myPendingReviewerStep(currentSteps, user?.id) : null
  const action = isInmateReporter
    ? reporterAction === 'correct-resubmit'
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
  const queue = useAwaitingQueue(
    Number.isFinite(bookId) ? bookId : null,
    current?.id ?? null,
    effectiveApprovalContext,
    effectiveApprovalContext != null,
  )
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
    onError: (err) => toast.error(apiErrorMessage(err)),
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
      setDecision(null)
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
          kind: 'approver', status: 'pending', sort: 'oldest', limit: 2, offset: 0,
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

  function handleRevise(): void {
    if (!book || !current?.template_id) return
    navigate(`/application?form=${encodeURIComponent(current.template_id)}`, {
      state: { reviseBookId: book.id },
    })
  }

  // "Email via Outlook" — the record's own handoff entry point. It builds the
  // SAME one-item basket prefill the tray builds (subject/body templates,
  // reference PDF, book link) and routes to /ledger, where the handoff dialog
  // consumes it. A record with no generated document has nothing to attach, so
  // the action stays disabled rather than producing an empty email.
  const recordHasPapers = current?.document_id != null
  const [emailingRecord, setEmailingRecord] = useState(false)

  async function handleEmailViaOutlook(): Promise<void> {
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
  }

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
      setDecision(null)
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

  function openMobileDecision(nextDecision: 'return' | 'reject'): void {
    setReason('')
    setDecision(nextDecision)
    requestAnimationFrame(() => {
      decisionPanelRef.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'end',
      })
      decisionReasonRef.current?.focus({ preventScroll: true })
    })
  }

  // Every page sign control (desktop header, mobile inline panel, mobile
  // dock) requests through here instead of calling `signMutation.mutate()`
  // directly — captures the record/version the confirmation is FOR, so a
  // stale confirm can't fire (see the render-time correction below and the
  // re-check in `confirmSign`).
  function requestSignConfirm(triggerRef: React.RefObject<HTMLButtonElement | null>): void {
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
  }

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

      {/* header — three rows at phone width, one row from lg.
          `basis-full` on the chips and the action cluster is what forces the
          split: without it they ride on row 1 and squeeze the identity block
          (which is `flex-1`, so it shrinks to a sliver) until a long Latin name
          in an RTL layout wraps into a five-line column. The `lg:min-w`
          floor keeps that from happening on desktop too, where a crowded action
          cluster used to eat the same space — it wraps instead. */}
      <header className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b border-hairline bg-gradient-to-b from-surface to-surface-tinted/40 px-4 py-3 sm:px-5 sm:py-3.5">
        <button
          type="button"
          onClick={() => navigate('/books')}
          aria-label={t('books.record.back')}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-hairline bg-surface text-primary transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" strokeWidth={2.2} />
        </button>
        {!isInmateReporter && (
          <QueueNav
            position={queue.position}
            total={queue.total}
            onPrev={() => {
              setArmedFor(null)
              if (queue.prevId == null) return
              navigate(
                effectiveApprovalContext
                  ? approvalRecordUrl(queue.prevId, queue.prevVersionId, effectiveApprovalContext)
                  : `/books/${queue.prevId}`,
              )
            }}
            onNext={() => {
              setArmedFor(null)
              if (queue.nextId == null) return
              navigate(
                effectiveApprovalContext
                  ? approvalRecordUrl(queue.nextId, queue.nextVersionId, effectiveApprovalContext)
                  : `/books/${queue.nextId}`,
              )
            }}
          />
        )}
        <div className="min-w-0 flex-1 lg:min-w-[18rem]">
          <div className="font-mono text-[0.72em] font-semibold tracking-wide text-primary">
            {book?.ref_number ?? '—'}
          </div>
          {/* Wraps freely below `lg` so the complete subject is readable on
              phone/tablet; the one-row desktop header keeps the single-line
              truncate it always had. */}
          <h1 className="text-[1.05em] font-bold tracking-tight text-foreground lg:truncate">
            {book?.subject ?? (isPending ? t('books.record.loading') : t('books.record.untitled'))}
          </h1>
          {/* One line, and the G number wins the space fight: the label and the
              G stay whole (`shrink-0`) while the name — the only unbounded part,
              and long in practice ("SAEED ASHED SANAD KHALFAN ALYAHYAEE") —
              truncates. Truncating the whole line instead would drop the G,
              which is the identifier people actually search on.
              The name is its own `dir="ltr"` bdi so the ellipsis lands at the
              END of the Latin run ("SAEED ASHED SANAD…"); left to inherit RTL,
              the browser clips the run's head instead and it reads as gibberish. */}
          <div
            className="mt-0.5 flex items-baseline gap-1 text-[0.72em] text-muted-foreground"
            title={submitter}
          >
            <span className="shrink-0">{t('books.record.submittedBy')}</span>
            <bdi dir="ltr" className="min-w-0 truncate font-semibold text-foreground">
              {submitter}
            </bdi>
            {book?.submitted_by_g && (
              <span className="shrink-0 font-mono text-primary">
                · <bdi dir="ltr">{book.submitted_by_g}</bdi>
              </span>
            )}
          </div>
        </div>
        <div className="flex basis-full flex-wrap items-center gap-1.5 lg:ms-1 lg:basis-auto">
          {book && (
            <StatePill state={state} signingPath={book.signing_path} signedSource={signedSource} />
          )}
          {/* Classification / draft / editing / voided chips */}
          {book && (
            <BookStatusChips book={book} />
          )}
        </div>
        {/* Reopen-in-Word and adjust-signature render as Tools menu items
            below, but the components owning their mutation/dialog/eligibility
            query are mounted here unconditionally — independent of the
            dropdown's open/closed state (see the components' own docs). */}
        {!isInmateReporter && book && canMutateCurrent && (
          <WordReopenButton
            book={book}
            isMobile={isMobile}
            hideTrigger
            onTriggerChange={setWordReopenTrigger}
          />
        )}
        {!isInmateReporter && canMutateCurrent && current?.document_id != null && (
          <AdjustSignatureAction
            documentId={current.document_id}
            hideTrigger
            onTriggerChange={setAdjustSigTrigger}
          />
        )}
        <input
          ref={fileSignedRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f && book) {
              void addScan.fileSignedCopy(f, book.ref_number).then(() => void refetch())
            }
            e.target.value = ''
          }}
        />
        <input
          ref={replaceSignedRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void manage.replacePaper(signedPaper, f)
            e.target.value = ''
          }}
        />

        {/* Persistent workflow bar: the current record's next step(s), always
            labelled — never icon-only. Same content set on mobile (minus the
            decide triple, which the dock + inline reason panel below already
            own) so revise/submit/scan-signed/Word-session stay reachable with
            readable labels on phone, not just desktop. */}
        {(Boolean(book && canMutateCurrent && book.edit_session?.state === 'active') ||
          (action === 'decide' && !isMobile) ||
          (action === 'review' && book && current) ||
          action === 'revise' ||
          showSendForApproval ||
          showFileSigned) && (
          <div className="flex w-full flex-wrap items-center gap-2 rounded-xl bg-primary-soft/60 px-3 py-2.5">
            {!isInmateReporter && book && canMutateCurrent && (
              <WordSessionActions book={book} isMobile={isMobile} />
            )}
            {action === 'decide' && !isMobile && (
              <>
                <HeaderBtn
                  ref={desktopSignRef}
                  icon={<PenLine className="h-3.5 w-3.5" />}
                  label={t('books.approval.signApprove')}
                  tone="green-solid"
                  disabled={busy}
                  onClick={() => requestSignConfirm(desktopSignRef)}
                />
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
              </>
            )}

            {action === 'review' && book && current && (
              <div data-testid="record-reviewer-actions">
                <ReviewerActions bookId={book.id} versionId={current.id} />
              </div>
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

            {showSendForApproval && (
              <HeaderBtn
                icon={<Send className="h-3.5 w-3.5" />}
                label={t('books.approval.submitForApproval')}
                tone="navy-solid"
                onClick={() => {
                  if (isInmateReporter) reporterSubmitMutation.mutate()
                  else setSubmitOpen(true)
                }}
              />
            )}

            {showFileSigned && (
              <HeaderBtn
                icon={<Upload className="h-3.5 w-3.5" />}
                label={t('books.pane.scanSignedCopy')}
                tone="plain"
                disabled={addScan.busy}
                onClick={() => fileSignedRef.current?.click()}
              />
            )}
          </div>
        )}

        {/* Viewer/workflow utility row: the annotation-mode toggle stays a
            standalone, always-visible control (its armed state must never
            hide inside a closed menu) next to the Tools dropdown, which holds
            every other tool grouped by purpose. */}
        <div className="flex w-full items-center justify-end gap-1.5 lg:ms-auto lg:w-auto">
          {canMark && (
            <MarkToggle armed={armed} onToggle={() => setArmedFor(armed ? null : bookId)} />
          )}
          {book && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <HeaderBtn
                  icon={<Wrench className="h-3.5 w-3.5" aria-hidden="true" />}
                  label={t('books.record.tools')}
                  tone="plain"
                />
              </DropdownMenuTrigger>
              {/* Portaled outside the print-hidden header: without the marker the
                  still-open menu lands on the sheet when Print runs from it. */}
              <DropdownMenuContent align="end" data-print-hide>
                <div className="px-2.5 pb-1 pt-1.5 text-[0.62em] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  {t('books.record.toolsDocument')}
                </div>
                <DropdownMenuItem onSelect={() => window.print()}>
                  <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('books.record.print')}
                </DropdownMenuItem>
                {/* Hand this record to Outlook. Same one-item basket prefill the
                    tray builds, so subject/body/reference PDF and the book link
                    are identical whether you email one record or a whole basket. */}
                {!isInmateReporter && (
                  <DropdownMenuItem
                    disabled={!recordHasPapers || emailingRecord}
                    onSelect={() => void handleEmailViaOutlook()}
                  >
                    {emailingRecord ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {t('books.record.emailViaOutlook')}
                  </DropdownMenuItem>
                )}
                {canManageIncludedPapers && (
                  <DropdownMenuItem onSelect={() => setIncludedPapersOpen(true)}>
                    <FileStack className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('books.includedPapers.addToPdf', { defaultValue: 'Add to PDF' })}
                  </DropdownMenuItem>
                )}
                {state === 'approved' && current?.signed_pdf_url && (
                  <DropdownMenuItem asChild>
                    <a href={current.signed_pdf_url} target="_blank" rel="noopener noreferrer">
                      <Check className="h-3.5 w-3.5" strokeWidth={2.6} aria-hidden="true" />
                      {t('books.record.downloadSigned')}
                    </a>
                  </DropdownMenuItem>
                )}
                {!isInmateReporter &&
                  state === 'approved' &&
                  current?.signed_pdf_url &&
                  current?.document_id != null && (
                    <DropdownMenuItem asChild>
                      <a
                        href={`/api/v1/documents/${current.document_id}/download?format=pdf&original=true`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('books.record.viewOriginal')}
                      </a>
                    </DropdownMenuItem>
                  )}

                {!isInmateReporter &&
                  (wordReopenTrigger != null ||
                    adjustSigTrigger != null ||
                    canManageSignedPaper) && (
                  <>
                    <DropdownMenuSeparator />
                    <div className="px-2.5 pb-1 pt-1.5 text-[0.62em] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      {t('books.record.toolsEditing')}
                    </div>
                    {wordReopenTrigger && (
                      <DropdownMenuItem
                        disabled={wordReopenTrigger.disabled}
                        onSelect={() => wordReopenTrigger.onClick()}
                      >
                        {wordReopenTrigger.icon}
                        {wordReopenTrigger.label}
                      </DropdownMenuItem>
                    )}
                    {adjustSigTrigger && (
                      <DropdownMenuItem onSelect={() => adjustSigTrigger.onClick()}>
                        {adjustSigTrigger.icon}
                        {adjustSigTrigger.label}
                      </DropdownMenuItem>
                    )}
                    {canManageSignedPaper && (
                      <DropdownMenuItem onSelect={() => replaceSignedRef.current?.click()}>
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('books.pane.replacePaper')}
                      </DropdownMenuItem>
                    )}
                  </>
                )}

                {!isInmateReporter &&
                  ((canOverrideState && canMutateCurrent) ||
                    canManageRevisionAccess ||
                    canManageSignedPaper) && (
                  <>
                    <DropdownMenuSeparator />
                    <div className="px-2.5 pb-1 pt-1.5 text-[0.62em] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      {t('books.record.toolsAdmin')}
                    </div>
                    {canOverrideState && canMutateCurrent && (
                      <DropdownMenuItem
                        data-testid="state-override-trigger"
                        onSelect={() => setStateOverrideOpen(true)}
                      >
                        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('books.stateOverride.trigger')}
                      </DropdownMenuItem>
                    )}
                    {canManageRevisionAccess && (
                      <DropdownMenuItem
                        data-testid="revision-access-trigger"
                        onSelect={() => setRevisionAccessOpen(true)}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('books.approval.revisionAccess')}
                      </DropdownMenuItem>
                    )}
                    {canManageSignedPaper && (
                      <DropdownMenuItem variant="danger" onSelect={() => setUnfileOpen(true)}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('books.pane.unfileSignedBtn')}
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      {book && pdfUrl && canManageIncludedPapers && (
        <IncludedPapersDialog
          open={includedPapersOpen}
          onOpenChange={setIncludedPapersOpen}
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
        onConfirm={() => {
          setUnfileOpen(false)
          void manage.deletePaper(signedPaper)
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
      {state === 'approved' && nextWaiting !== undefined && (
        <div
          className="border-b border-hairline bg-success-soft/40 px-5 py-2.5 text-[0.8em]"
          data-print-hide
        >
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
              className="font-semibold text-success underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('books.approval.reviewNextWaiting')} — <bdi dir="ltr">{nextWaiting.refNumber}</bdi>
            </button>
          ) : (
            <span className="text-muted-foreground">{t('books.approval.noSignaturesWaiting')}</span>
          )}
        </div>
      )}

      {/* override banner: approver sees that reviewers requested changes */}
      {action === 'decide' && changesRequestedCount(currentSteps) > 0 && (
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

      {/* Mobile status disclosure — the desktop progress rail is `hidden
          md:block` (physically inert below `md`, never focusable there); this
          is its complement, `md:hidden`, so exactly one of the two surfaces is
          ever in the accessibility tree. Native `<details>` gives free
          expand/collapse semantics (no extra state) with a one-line summary —
          the live station, or the latest completed one when there is no live
          station (see `currentSummaryStation`) — and the full timeline plus
          reviewer/notification content on expand, reusing the exact same
          `RecordTimelineContent` the desktop sidebar renders. */}
      {book && (
        <div className="border-b border-hairline bg-surface px-4 py-3 md:hidden" data-print-hide>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
              {(() => {
                const summary = currentSummaryStation(stations)
                const tone = summary ? TONE[summary.tone] : undefined
                return (
                  <span className="flex min-w-0 items-center gap-2 text-[0.82em] font-semibold text-foreground">
                    {tone && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: tone.fg }}
                        aria-hidden
                      />
                    )}
                    <span className="min-w-0 truncate">
                      {summary?.label}
                      {summary?.meta ? ` — ${bidi(summary.meta)}` : ''}
                    </span>
                  </span>
                )
              })()}
              <ChevronDown
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                aria-hidden
              />
            </summary>
            <div className="mt-3">
              <RecordTimelineContent
                stations={stations}
                currentSteps={currentSteps}
                currentVersionNo={current?.version_no}
                liveVersionNo={liveVersion?.version_no}
                sms={book.sms}
              />
            </div>
          </details>
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
          className="flex flex-1 justify-center overflow-auto px-6 py-7 max-md:flex-col max-md:items-center max-md:justify-start max-md:pb-4"
          style={{
            background:
              'radial-gradient(150% 100% at 40% -10%, var(--surface) 0%, var(--surface-tinted) 70%, var(--bg) 100%)',
          }}
        >
          <div className="print-paper relative w-full max-w-[640px]">
            {pdfUrl ? (
              <Suspense fallback={<DeskLoading />}>
                <DocPdfCanvas
                  pdfUrl={pdfUrl}
                  docxUrl={current?.docx_url ?? undefined}
                  onReady={onPdfReady}
                  renderOverlay={
                    annotatable
                      ? (pages) => (
                          // Annotation pins are screen-only review marks — hidden
                          // on the printed copy (display:contents keeps placement
                          // math anchored to the canvas wrapper on screen).
                          <div data-print-hide style={{ display: 'contents' }}>
                            <BookAnnotationLayer
                              pages={pages}
                              annotations={annotations}
                              mode={annMode}
                              armed={armed}
                              currentUserId={user?.id}
                              busy={createMark.isPending || deleteMark.isPending}
                              onCreate={(m) => createMark.mutate(m)}
                              onDelete={(id) => deleteMark.mutate(id)}
                              onDisarm={() => setArmedFor(null)}
                            />
                          </div>
                        )
                      : undefined
                  }
                />
              </Suspense>
            ) : isPending ? (
              <div className="flex h-full min-h-[400px] items-center justify-center text-[0.85em] text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : !isInmateReporter && book?.imported_doc ? (
              // Imported record whose vault file isn't a PDF (e.g. .docx) — no
              // inline preview, so offer the original for download.
              <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-3 text-center text-[0.85em] text-muted-foreground">
                <span className="max-w-[40ch]">{t('books.record.importedNoPreview')}</span>
                <a
                  href={book.imported_doc.download_url}
                  download={book.imported_doc.filename}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[0.95em] font-semibold text-primary-foreground hover:bg-primary-hover"
                >
                  {t('books.record.downloadImported', {
                    format: book.imported_doc.format.toUpperCase(),
                  })}
                </a>
              </div>
            ) : book?.edit_session?.state === 'active' ? (
              // The body is still being written in Word — there is genuinely no
              // document yet, but that's expected, not an error; the Word-session
              // controls (Finish editing / Discard) are already visible above.
              <div className="flex h-full min-h-[400px] items-center justify-center text-[0.85em] text-muted-foreground">
                {t('books.word.bodyInWord')}
              </div>
            ) : action === 'revise' && canRevise ? (
              // A returned/rejected record whose document isn't on file (or was
              // removed) — the one real recovery already available from this
              // page is the same Revise action the workflow bar offers.
              <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-3 text-center text-[0.85em] text-muted-foreground">
                <span className="max-w-[36ch]">{t('books.record.noDocument')}</span>
                <button
                  type="button"
                  onClick={handleRevise}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[0.95em] font-semibold text-primary-foreground hover:bg-primary-hover"
                >
                  {t('books.versions.revise')}
                </button>
              </div>
            ) : (
              // Nothing produced this document and no action on this page would
              // fix that — submitting doesn't create one, so no CTA is offered.
              <div className="flex h-full min-h-[400px] items-center justify-center text-[0.85em] text-muted-foreground">
                {t('books.record.noDocument')}
              </div>
            )}
          </div>
          {isMobile && action === 'decide' && (
            <div
              ref={decisionPanelRef}
              dir={isAr ? 'rtl' : 'ltr'}
              data-print-hide
              className="mt-5 w-full max-w-[640px] md:hidden"
            >
              <RecordDecisionActions
                returnButtonRef={panelReturnButtonRef}
                rejectButtonRef={panelRejectButtonRef}
                signButtonRef={mobileInlineSignRef}
                busy={busy}
                onSign={() => requestSignConfirm(mobileInlineSignRef)}
                onReturn={() => {
                  setReason('')
                  setDecision('return')
                }}
                onReject={() => {
                  setReason('')
                  setDecision('reject')
                }}
              />
              {decision !== null && (
                <div className="mt-3 rounded-xl border border-hairline bg-surface p-3.5">
                  <DecisionReasonForm {...decisionReasonFormProps} act={decision} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* vertical progress timeline — physically pinned to the right in both
            languages (see the outer `direction:ltr`); `hidden md:block` makes
            it inert and unfocusable below `md`, where the details/summary
            block above is its sole complement. */}
        <aside
          dir={isAr ? 'rtl' : 'ltr'}
          className="hidden w-[236px] shrink-0 overflow-auto border-s border-hairline bg-surface px-5 py-6 md:block"
        >
          <RecordTimelineContent
            stations={stations}
            currentSteps={currentSteps}
            currentVersionNo={current?.version_no}
            liveVersionNo={liveVersion?.version_no}
            sms={book?.sms}
          />
        </aside>
      </div>

      {isMobile &&
        action === 'decide' &&
        createPortal(
          <div
            dir={isAr ? 'rtl' : 'ltr'}
            data-print-hide
            aria-hidden={dockHidden ? true : undefined}
            inert={dockHidden}
            className={cn(
              'fixed inset-x-0 bottom-[calc(5.5rem+var(--safe-bottom))] z-40 border-t border-hairline bg-surface/95 px-3 pt-2 backdrop-blur md:hidden',
              'pb-[max(0.5rem,var(--safe-bottom))]',
              'transition-opacity motion-reduce:transition-none',
              dockHidden && 'pointer-events-none opacity-0',
            )}
          >
            <RecordDecisionActions
              signButtonRef={mobileDockSignRef}
              busy={busy}
              onSign={() => requestSignConfirm(mobileDockSignRef)}
              onReturn={() => openMobileDecision('return')}
              onReject={() => openMobileDecision('reject')}
            />
          </div>,
          document.body,
        )}

      {!isInmateReporter && submitOpen && book && (
        <SubmitForApprovalDialog bookId={book.id} onClose={() => setSubmitOpen(false)} />
      )}

      {stateOverrideOpen && book && canOverrideState && (
        <RecordStateOverrideDialog book={book} onClose={() => setStateOverrideOpen(false)} />
      )}

      {revisionAccessOpen && book && canManageRevisionAccess && (
        <RevisionAccessPanel bookId={book.id} onClose={() => setRevisionAccessOpen(false)} />
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

function NotificationBlock({ messages }: { messages: NotifyMessageRead[] }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const fmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )
  return (
    <div className="mt-6">
      <h2 className="mb-3 text-[0.66em] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {t('books.record.notification')}
      </h2>
      <div className="flex flex-col gap-2">
        {messages.map((m) => {
          const tone = smsDeliveryTone(m)
          const badge = {
            delivered: {
              cls: 'bg-success-soft text-success',
              icon: <Check className="h-3 w-3" />,
              label: t('employee.messages.delivered'),
            },
            failed: {
              cls: 'bg-destructive/10 text-destructive',
              icon: <AlertTriangle className="h-3 w-3" />,
              label: t('employee.messages.failed'),
            },
            pending: {
              cls: 'bg-warning/10 text-warning',
              icon: <Clock className="h-3 w-3" />,
              label: t('employee.messages.pending'),
            },
          }[tone]
          return (
            <div key={m.id} className="rounded-lg border border-hairline bg-surface p-2.5 text-[0.78em]">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold ${badge.cls}`}>
                  {badge.icon}
                  {badge.label}
                </span>
                <span className="ms-auto font-mono text-muted-foreground">
                  {fmt.format(new Date(m.created_at))}
                </span>
              </div>
              {m.body && (
                <div className="whitespace-pre-wrap text-foreground" dir="auto">
                  {m.body}
                </div>
              )}
              {tone === 'failed' && m.error && (
                <div className="mt-1 text-destructive" dir="ltr">{m.error}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default BookRecordPage
