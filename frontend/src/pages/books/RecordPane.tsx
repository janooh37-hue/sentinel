/**
 * Records page — the record pane: ref · status seal · pane controls, the
 * record's identity (form · creator · date), its one-line status, the paper
 * viewer, and the footer (≤2 workflow buttons from `recordNextStep`, "Open
 * record", and a "More" menu). Hosts the full-preview overlay and the add-scan
 * flow (＋ frame, hidden file input, other-record confirm dialog).
 *
 * Three presentations, picked by the page:
 *   inline · normal / wide   a grid column beside the list
 *   inline · collapsed       a 52px strip that re-expands on click
 *   drawer                   the same content as an end-anchored drawer (the
 *                            page owns the portal, scrim and Esc)
 */
import { Suspense, lazy, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  ChevronsLeftRight,
  Copy,
  CornerUpLeft,
  Download,
  ExternalLink,
  FileStack,
  Loader2,
  Mail,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  Plus,
  Send,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api, type BookRead } from '@/lib/api'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Hint } from '@/components/ui/hint'
import { IconAction } from '@/components/ui/icon-action'
import { useAuth } from '@/lib/authContext'
import { bidi } from '@/lib/bidi'
import { currentBookDocId } from '@/lib/bookDocument'
import { copyToClipboard } from '@/lib/clipboard'
import { serviceHref } from '@/lib/quickActions'
import { useCapabilities } from '@/lib/useCapabilities'
import { useFocusTrap } from '@/lib/useFocusTrap'
import { useIsMobile } from '@/lib/useIsMobile'
import { cn } from '@/lib/utils'

import { inmateReporterActionFor } from '@/components/books/book-detail-drawer-utils'
import { isApproverAssignee, myPendingReviewerStep } from '@/components/books/reviewers'
import { BookStatusChips } from '@/components/books/BookStatusChips'
import { DocumentState } from '@/components/books/DocumentState'
import { ServiceArtwork } from '@/components/ui/service-artwork'
import { WordReopenButton, WordSessionActions } from '@/components/books/BookWordActions'
import type { WordReopenTrigger } from '@/components/books/BookWordActions'
import { WordSessionBanner } from '@/components/books/WordSessionBanner'
import { sealDescriptor, signedSourceOf } from './bookStateLabel'
import { IncludedPapersDialog } from './IncludedPapersDialog'
import { isIncludedPapersOwner } from './includedPapersState'
import { subjectEmployeePart } from './formKind'
import { deleteBlockReason, deleteReasonKey } from './recordDelete'
import {
  recordNextStep,
  type ActionId,
  type NextStep,
  type ReasonKey,
} from './recordNextStep'
import {
  defaultPaperKey,
  paperKey,
  paperResetSignature,
  papersOf,
  type Paper,
  type PaperKey,
} from './recordPapers'
import { serviceArtwork, serviceGlyph, useServiceLabel } from './serviceLabels'
import { StateSeal } from './StateSeal'
import { useAddScan } from './useAddScan'
import { useManagePaper } from './useManagePaper'
import { openRecord, recordLinkProps, type RecordNavState } from './useRecordNavContext'
import { useRecordDelete } from './RecordDeleteProvider'

const RecordPaperViewer = lazy(() => import('./RecordPaperViewer'))

export type PaneSize = 'collapsed' | 'normal' | 'wide'

/** One workflow button of the footer (≤2 per record). */
interface PaneAction {
  id: ActionId
  label: string
  icon: React.ReactNode
  primary: boolean
  disabled: boolean
  reason?: string
  onClick: () => void
}

export function RecordPane({
  book,
  mode,
  size,
  onSizeChange,
  onClose,
  nav,
  onContinueDraft,
  onSubmit,
  onSelectBook,
  onAddToEmail,
  onDeleted,
}: {
  book: BookRead | null
  /** `inline`: a grid column; `drawer`: the end-anchored drawer's content. */
  mode: 'inline' | 'drawer'
  /** Inline only. */
  size: PaneSize
  onSizeChange: (size: PaneSize) => void
  /** Drawer only: the × button. */
  onClose?: () => void
  /** The list's navigation context, read at click time (fresh scroll offset). */
  nav: () => RecordNavState
  onContinueDraft: (id: number) => void
  onSubmit: (id: number) => void
  /** select a different record (scan matched another ref) */
  onSelectBook: (id: number) => void
  /** add this record to the email basket (enriches + toasts) */
  onAddToEmail: (book: BookRead) => void
  /** The record was scheduled for deletion from here (the page moves the selection). */
  onDeleted: (id: number) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const serviceLabel = useServiceLabel()
  const { has } = useCapabilities()
  const { scheduleDelete } = useRecordDelete()
  const canEdit = has('books.edit')
  const canScanCap = has('documents.scan')
  const canScan = canScanCap && canEdit
  // State (not a ref): the workflow buttons built during render click it.
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null)
  const replaceRef = useRef<HTMLInputElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const addScan = useAddScan(book?.id ?? null)
  const manage = useManagePaper(book?.id ?? null)
  const [deleteTarget, setDeleteTarget] = useState<Paper | null>(null)
  const [replaceTarget, setReplaceTarget] = useState<Paper | null>(null)
  const [deleteRecordOpen, setDeleteRecordOpen] = useState(false)
  const [wordTrigger, setWordTrigger] = useState<WordReopenTrigger | null>(null)
  // Relative times ("2 days ago") are computed once per mounted pane; they need no ticking.
  const [now] = useState(() => Date.now())
  const { user } = useAuth()
  const isInmateReporter = user?.role === 'inmate_reporter'
  const [includedPapersOpen, setIncludedPapersOpen] = useState(false)
  const includedBookId = book?.id ?? null
  const includedDetail = useQuery({
    queryKey: ['books', 'detail', includedBookId],
    queryFn: () => api.getBook(includedBookId!),
    enabled: !isInmateReporter && includedPapersOpen && includedBookId !== null,
  })

  // Papers: signed → generated → imported → scans (shared with the record page
  // and the full-preview overlay, which receives this exact list).
  const papers = useMemo(
    () => (book ? papersOf(book, { inmateReporter: isInmateReporter }) : []),
    [book, isInmateReporter],
  )

  // The record's default paper (signed once filed, else the first non-signed).
  // An explicit pick is kept by key and falls back to the default if it
  // vanishes; a different record, state or paper set re-picks the default.
  const defaultKey = book ? defaultPaperKey(book, papers) : null
  const [pickedKey, setPickedKey] = useState<PaperKey | null>(null)
  const selectedKey =
    pickedKey !== null && papers.some((p) => paperKey(p) === pickedKey) ? pickedKey : defaultKey
  const selectedPaper = papers.find((p) => paperKey(p) === selectedKey)
  const [fullOpen, setFullOpen] = useState(false)
  const [draftScan, setDraftScan] = useState<File | null>(null)
  // The full-preview overlay is a hand-rolled portal (not Radix Dialog), so it
  // needs explicit focus management to honour its aria-modal claim: move focus
  // in on open, trap Tab inside, restore to the trigger on close (UI-01).
  const overlayRef = useFocusTrap<HTMLDivElement>(fullOpen)

  const signature = book ? paperResetSignature(book, papers) : ''
  const [prevSignature, setPrevSignature] = useState(signature)
  if (prevSignature !== signature) {
    setPrevSignature(signature)
    setPickedKey(null)
  }
  // reset overlays when the record changes (render-time derive, not effect)
  const bookKey = book?.id ?? null
  const [prevBookKey, setPrevBookKey] = useState(bookKey)
  if (prevBookKey !== bookKey) {
    setPrevBookKey(bookKey)
    setFullOpen(false)
    setIncludedPapersOpen(false)
    setDeleteRecordOpen(false)
  }

  useEffect(() => {
    if (!fullOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) setFullOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullOpen])

  // A drawer is a new surface: focus lands on its close button.
  useEffect(() => {
    if (mode === 'drawer') closeRef.current?.focus()
  }, [mode])

  const dataAttrs = { 'data-records-pane': '', 'data-pane-mode': mode } as const
  const shell = cn(
    'relative flex min-h-0 flex-col overflow-hidden bg-surface',
    mode === 'drawer'
      ? 'h-full border-s border-hairline'
      : 'rounded-2xl border border-hairline',
  )

  if (!book) {
    return (
      <aside
        {...dataAttrs}
        className={cn(shell, 'items-center justify-center p-6 text-center text-[0.8em] text-muted-foreground')}
      >
        {mode === 'drawer' && onClose && (
          <div className="absolute end-2 top-2">
            <IconAction ref={closeRef} aria-label={t('common.close')} onClick={onClose}>
              <X className="h-4 w-4" aria-hidden />
            </IconAction>
          </div>
        )}
        {t('books.pane.selectToPreview')}
      </aside>
    )
  }

  const state = book.approval_state
  const label = serviceLabel(book.service_id)
  const artwork = serviceArtwork(book.service_id)
  const glyph = serviceGlyph(book.service_id)
  const who = subjectEmployeePart(book.subject, { classified: !!book.classification_code })
  const seal = sealDescriptor(state, { signingPath: book.signing_path, signedSource: signedSourceOf(book) })

  if (mode === 'inline' && size === 'collapsed') {
    return (
      <aside {...dataAttrs} data-pane-size="collapsed" className={shell}>
        <Hint label={t('books.pane.normal')} side="start">
          <button
            type="button"
            aria-label={t('books.pane.normal')}
            onClick={() => onSizeChange('normal')}
            className="flex h-full w-full flex-col items-center gap-3 py-3 text-primary transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
          >
            <PanelRightOpen className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
            <span
              className="font-mono text-[0.72em] font-bold [writing-mode:vertical-rl]"
              dir="ltr"
            >
              {book.ref_number}
            </span>
            <seal.Icon className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">{t(seal.labelKey)}</span>
          </button>
        </Hint>
      </aside>
    )
  }

  // ── Next step: the one status sentence + the footer's workflow buttons ─────
  // Word-authored book: its truth is the docx, not re-renderable fields. The
  // rich-editor "Continue editing" would open an empty form, so it's hidden for
  // these (BookWordActions carries the Word actions). `is_word_book` is a
  // backend flag computed for LIST rows too.
  const isWordBook = book.is_word_book
  const versions = book.versions ?? []
  const liveVersion = versions.length ? versions[versions.length - 1] : undefined
  const currentVersion =
    (book.selected_version_id != null
      ? versions.find((v) => v.id === book.selected_version_id)
      : undefined) ?? liveVersion
  const isLiveCurrent = currentVersion != null && currentVersion.version_no === liveVersion?.version_no
  const canMutateCurrent = book.access_scope !== 'assigned_revision' && isLiveCurrent
  const reporterAction = inmateReporterActionFor(book, user?.id)
  const isInmateReport =
    isInmateReporter && book.ref_number.startsWith('REPORT-') && reporterAction !== 'read-only'
  const steps = currentVersion?.approval_steps ?? book.approval_steps ?? []
  const hasDocument = currentBookDocId(book) !== undefined || Boolean(book.imported_doc?.pdf_url)
  const canManageIncludedPapers =
    !isInmateReporter &&
    canMutateCurrent &&
    currentVersion?.document_id != null &&
    isIncludedPapersOwner(book, user?.id)
  const ns: NextStep = recordNextStep(book, {
    has,
    canEdit,
    canGenerate: has('documents.generate'),
    canMutateCurrent,
    isInmateReporter,
    inmateAction: reporterAction,
    isAssignee: isLiveCurrent && isApproverAssignee(steps, user?.id),
    isReviewer: isLiveCurrent && myPendingReviewerStep(steps, user?.id) != null,
    hasDocument,
    canManageIncludedPapers,
    now,
    locale: i18n.language,
  })
  const reasonOf = (id: ActionId): string | undefined => {
    const key: ReasonKey | undefined = ns.disabled?.[id]
    return key ? t(key) : undefined
  }
  const statusVars = { ...ns.status.vars, ...(ns.status.vars.name ? { name: bidi(ns.status.vars.name) } : null) }
  const openFull = (): void => openRecord(navigate, book.id, nav())
  const signedPaper = papers.find((p) => p.kind === 'signed')

  // Decision actions (sign / return / reject / review) run on the record page,
  // where the paper is read and the confirm lives: the pane offers the primary
  // as an entry point and drops the secondary decisions.
  const actionDef = (id: ActionId): Omit<PaneAction, 'primary'> | null => {
    const base = { id, disabled: false, reason: reasonOf(id) }
    switch (id) {
      case 'sendForApproval':
        return { ...base, label: t('books.approval.submitForApproval'), icon: <Send className="h-3.5 w-3.5" aria-hidden />, onClick: () => onSubmit(book.id) }
      case 'continueEditing':
        return isWordBook || isInmateReport
          ? null
          : { ...base, label: t('books.pane.continueDraft'), icon: <PenLine className="h-3.5 w-3.5" aria-hidden />, onClick: () => onContinueDraft(book.id) }
      case 'revise':
        return { ...base, label: t('books.pane.revise'), icon: <CornerUpLeft className="h-3.5 w-3.5 -scale-x-100" aria-hidden />, onClick: openFull }
      case 'scanSigned':
        return { ...base, disabled: addScan.busy, label: t('books.pane.scanSignedCopy'), icon: <Upload className="h-3.5 w-3.5" aria-hidden />, onClick: () => fileInput?.click() }
      case 'downloadSigned':
        return signedPaper
          ? { ...base, label: t('books.record.downloadSigned'), icon: <Download className="h-3.5 w-3.5" aria-hidden />, onClick: () => downloadPaper(signedPaper) }
          : null
      case 'sign':
        return { ...base, label: t('books.approval.signApprove'), icon: <PenLine className="h-3.5 w-3.5" aria-hidden />, onClick: openFull }
      case 'approveReviewed':
        return { ...base, label: t('books.reviewers.approveReviewed'), icon: <PenLine className="h-3.5 w-3.5" aria-hidden />, onClick: openFull }
      default:
        return null
    }
  }
  const workflow: PaneAction[] = [ns.primary, ...ns.secondary]
    .filter((id): id is ActionId => id !== undefined)
    .filter((id) => id !== 'returnForChanges' && id !== 'reject' && id !== 'requestChanges')
    .flatMap((id) => {
      const def = actionDef(id)
      return def ? [{ ...def, primary: id === ns.primary }] : []
    })
    .slice(0, 2)
  const scanSignedShown = workflow.some((a) => a.id === 'scanSigned')

  // ── More ▾ ────────────────────────────────────────────────────────────────
  const hasWordReopen =
    (!isInmateReporter || isInmateReport) &&
    !book.voided_at &&
    (versions.length > 0 || isWordBook) &&
    book.edit_session?.state !== 'active'
  const showScanSignedInMenu = ns.overflow.includes('scanSigned') && !scanSignedShown
  const showAddToPdf = canManageIncludedPapers
  const showEmail = !isInmateReporter && ns.overflow.includes('email')
  const emailReason = reasonOf('email')
  const delReason = deleteBlockReason(book, { has, isInmateReporter })
  const showDelete = delReason !== 'noCapability' && delReason !== 'restricted'
  const delReasonKey = deleteReasonKey(delReason)
  const deleteLabel = state === 'none' ? t('books.record.deleteDraft') : t('books.record.delete')
  const hasMoreItems =
    wordTrigger !== null || showScanSignedInMenu || showAddToPdf || showEmail || showDelete

  const includedDocumentId = includedDetail.data ? currentBookDocId(includedDetail.data) : undefined

  const emptyState = (() => {
    if (!isInmateReporter && book.imported_doc) {
      // Imported record whose vault file isn't a PDF (e.g. .docx): no inline
      // preview, so offer the original for download.
      return (
        <DocumentState
          kind="empty"
          body={t('books.record.importedNoPreview')}
          action={
            <a
              href={book.imported_doc.download_url}
              download={book.imported_doc.filename}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[0.85em] font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              {t('books.record.downloadImported', { format: book.imported_doc.format.toUpperCase() })}
            </a>
          }
        />
      )
    }
    if (book.edit_session?.state === 'active') {
      // The body is still being written in Word: expected, not an error. The
      // Word-session controls are in the footer.
      return <DocumentState kind="empty" title={t('books.word.bodyInWord')} body="" />
    }
    if (ns.primary === 'revise' && !ns.disabled?.revise && currentVersion?.template_id) {
      // A returned/rejected record whose document isn't on file: the one real
      // recovery is the same Revise action the record page offers.
      const templateId = currentVersion.template_id
      return (
        <DocumentState
          kind="empty"
          body={t('books.record.noDocument')}
          action={
            <Button
              type="button"
              size="sm"
              onClick={() => navigate(`${serviceHref(templateId)}?revise=${book.id}`)}
            >
              {t('books.versions.revise')}
            </Button>
          }
        />
      )
    }
    return <DocumentState kind="empty" body={t('books.record.noDocument')} />
  })()

  const addScanSlot = !isInmateReporter && canScan ? (
    <Hint label={t('books.pane.addScanHint')}>
      <button
        type="button"
        disabled={addScan.busy}
        onClick={() => fileInput?.click()}
        className="flex w-14 shrink-0 flex-col items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="grid aspect-[210/297] w-full place-items-center rounded-[3px] border-2 border-dashed border-border bg-surface-raised text-faint transition-colors hover:border-primary hover:text-primary motion-reduce:transition-none">
          {addScan.busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Plus className="h-4 w-4" aria-hidden />
          )}
        </span>
        <span className="w-full truncate text-center text-[0.56em] leading-tight text-faint">{t('books.pane.addScan')}</span>
      </button>
    </Hint>
  ) : undefined

  const deletePaperHandlers = {
    onDeletePaper: !isInmateReporter && canEdit ? setDeleteTarget : undefined,
    onReplacePaper:
      !isInmateReporter && canEdit
        ? (p: Paper) => {
            setReplaceTarget(p)
            replaceRef.current?.click()
          }
        : undefined,
  }

  return (
    <aside {...dataAttrs} data-pane-size={mode === 'inline' ? size : undefined} className={shell}>
      {/* Header: ref (copy) · seal · pane controls */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-hairline px-3 py-2">
        <Hint label={t('books.record.copyRef')} shortcut="C" side="bottom">
          <button
            type="button"
            aria-label={t('books.record.copyRef')}
            onClick={() => {
              void copyToClipboard(book.ref_number).then((ok) => {
                if (ok) toast.success(t('books.record.copiedRef', { ref: bidi(book.ref_number) }))
                else toast.error(t('common.copyFailed'))
              })
            }}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-sm border-[1.5px] border-primary px-2 py-0.5 font-mono text-[0.72em] font-bold text-primary transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none pointer-coarse:min-h-11"
          >
            <bdi dir="ltr" className="tabular-nums">{book.ref_number}</bdi>
            <Copy className="h-3 w-3" aria-hidden />
          </button>
        </Hint>
        <StateSeal state={state} signingPath={book.signing_path} signedSource={signedSourceOf(book)} />
        <span className="ms-auto flex items-center gap-1">
          {mode === 'inline' ? (
            <>
              <IconAction
                aria-label={t('books.pane.collapse')}
                hint={t('books.pane.collapse')}
                hintSide="bottom"
                onClick={() => onSizeChange('collapsed')}
                className="border-transparent bg-transparent pointer-coarse:h-11 pointer-coarse:w-11"
              >
                <PanelRightClose className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
              </IconAction>
              <IconAction
                aria-label={size === 'wide' ? t('books.pane.normal') : t('books.pane.wider')}
                hint={size === 'wide' ? t('books.pane.normal') : t('books.pane.wider')}
                hintSide="bottom"
                pressed={size === 'wide'}
                onClick={() => onSizeChange(size === 'wide' ? 'normal' : 'wide')}
                className="border-transparent bg-transparent pointer-coarse:h-11 pointer-coarse:w-11"
              >
                <ChevronsLeftRight className="h-4 w-4" aria-hidden />
              </IconAction>
            </>
          ) : (
            <IconAction
              ref={closeRef}
              aria-label={t('common.close')}
              hint={t('common.close')}
              shortcut="Esc"
              hintSide="bottom"
              onClick={onClose}
              className="border-transparent bg-transparent pointer-coarse:h-11 pointer-coarse:w-11"
            >
              <X className="h-4 w-4" aria-hidden />
            </IconAction>
          )}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Identity: form · who · creator · date */}
        <div className="px-3.5 pt-3">
          <h2 className="flex items-center gap-1.5 text-[0.9em] font-bold">
            {artwork ? (
              <ServiceArtwork artwork={artwork} size="inline" className="shrink-0" />
            ) : (
              <span aria-hidden>{glyph}</span>
            )}
            <span className="min-w-0 truncate">{label}</span>
          </h2>
          {who && (
            <p className="mt-0.5 truncate text-[0.78em] text-foreground" dir="auto">
              {who}
            </p>
          )}
          <p className="mt-0.5 text-[0.7em] text-muted-foreground">
            {t('books.record.createdBy')}{' '}
            {book.created_by_name ? (
              <bdi>{book.created_by_name}</bdi>
            ) : (
              <span className="italic">{t('books.record.creatorUnknown')}</span>
            )}
            {book.created_by_g && (
              <>
                {' · '}
                <bdi dir="ltr" className="font-mono tabular-nums">{book.created_by_g}</bdi>
              </>
            )}
            {' · '}
            <bdi dir="ltr" className="font-mono tabular-nums">{book.created_at.slice(0, 10)}</bdi>
          </p>
          {/* Status: the sentence the record page header shows, with the returner's note */}
          <p className="mt-2 text-[0.78em] text-foreground">
            {t(`books.status.${ns.status.key}`, statusVars)}
            {ns.quote && (
              <q className="ms-1 italic text-muted-foreground" dir="auto">
                {ns.quote}
              </q>
            )}
          </p>
        </div>
        {/* Chips row: classification / draft / editing / voided */}
        {(book.classification_code || book.is_draft || book.edit_session?.state === 'active' || book.voided_at) && (
          <div className="flex flex-wrap gap-1.5 px-3.5 pt-2">
            <BookStatusChips book={book} />
          </div>
        )}
        {book.edit_session?.state === 'active' && (
          <div className="px-3.5 pt-2">
            <WordSessionBanner book={book} compact live={false} />
          </div>
        )}
        <div className="flex min-h-[20rem] flex-col pt-2">
          <Suspense fallback={<DocumentState kind="loading" />}>
            <RecordPaperViewer
              papers={papers}
              selectedKey={selectedKey}
              onSelectKey={setPickedKey}
              mode="pane"
              onOpenFull={() => setFullOpen(true)}
              addScanSlot={addScanSlot}
              emptySlot={emptyState}
              {...deletePaperHandlers}
            />
          </Suspense>
        </div>
      </div>

      {/* Footer: Word session · ≤2 workflow buttons · Open record · More */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-hairline px-3 py-2.5">
        {(!isInmateReporter || isInmateReport) && (
          <WordSessionActions
            book={book}
            labelled
            onFinished={isInmateReport ? () => onSubmit(book.id) : undefined}
          />
        )}
        {workflow.map((action) => (
          <PaneBtn
            key={action.id}
            label={action.label}
            primary={action.primary}
            disabled={action.disabled}
            reason={action.reason}
            onClick={action.onClick}
          >
            {action.icon}
            {action.label}
          </PaneBtn>
        ))}
        <Link
          {...recordLinkProps(book.id, nav())}
          onClick={(e) => {
            const modified = e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
            if (e.defaultPrevented || modified) return
            e.preventDefault()
            openFull()
          }}
          className={paneBtnClass({ primary: false })}
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          {t('books.pane.openRecord')}
        </Link>
        {hasMoreItems && (
          <span className="ms-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={paneBtnClass({ primary: false })}>
                  {t('books.pane.more')}
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top">
                {wordTrigger && (
                  <DropdownMenuItem disabled={wordTrigger.disabled} onSelect={wordTrigger.onClick}>
                    {wordTrigger.icon}
                    {wordTrigger.label}
                  </DropdownMenuItem>
                )}
                {showAddToPdf && (
                  <DropdownMenuItem
                    pending={includedDetail.isFetching}
                    onSelect={() => setIncludedPapersOpen(true)}
                  >
                    <FileStack className="h-3.5 w-3.5" aria-hidden />
                    {t('books.includedPapers.addToPdf')}
                  </DropdownMenuItem>
                )}
                {showEmail && (
                  <DropdownMenuItem reason={emailReason} onSelect={() => onAddToEmail(book)}>
                    <Mail className="h-3.5 w-3.5" aria-hidden />
                    {t('basket.add')}
                  </DropdownMenuItem>
                )}
                {showScanSignedInMenu && (
                  <DropdownMenuItem disabled={addScan.busy} onSelect={() => fileInput?.click()}>
                    <Upload className="h-3.5 w-3.5" aria-hidden />
                    {t('books.pane.scanSignedCopy')}
                  </DropdownMenuItem>
                )}
                {showDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="danger"
                      reason={delReasonKey ? t(delReasonKey) : undefined}
                      onSelect={() => setDeleteRecordOpen(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      {deleteLabel}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        )}
      </div>

      {/* Owns the "Edit in Word" mutation + handoff dialog; the trigger renders in More. */}
      {hasWordReopen && (
        <WordReopenButton
          book={book}
          hideTrigger
          onTriggerChange={setWordTrigger}
          onFinished={isInmateReport ? () => onSubmit(book.id) : undefined}
        />
      )}

      {includedDetail.data && includedDocumentId !== undefined && (
        <IncludedPapersDialog
          open={includedPapersOpen}
          onOpenChange={setIncludedPapersOpen}
          book={includedDetail.data}
          currentPdfUrl={api.documentDownloadUrl(includedDocumentId, 'pdf')}
        />
      )}

      <input
        ref={setFileInput}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) {
            // awaiting_scan: target is unambiguous — file the signed copy straight.
            // none/pending: ask whether this is the signed copy or just an attachment.
            // other (resolved) states: route by OCR'd ref.
            if (state === 'awaiting_scan') void addScan.fileSignedCopy(f, book.ref_number)
            else if (state === 'none' || state === 'pending') setDraftScan(f)
            else void addScan.submit(f)
          }
          e.target.value = ''
        }}
      />

      <ConfirmDialog
        open={addScan.otherMatch !== null}
        onOpenChange={(open) => {
          if (!open) addScan.clearOtherMatch()
        }}
        title={t('books.pane.scanMatchedOther', { ref: addScan.otherMatch?.ref ?? '' })}
        confirmLabel={t('books.pane.scanFileToOther', { ref: addScan.otherMatch?.ref ?? '' })}
        onConfirm={() => {
          const target = addScan.otherMatch?.bookId
          void addScan.fileToOther().then(() => {
            if (target !== undefined) onSelectBook(target)
          })
        }}
      />

      {/* Delete the record: deferred 6 s with an Undo toast (RecordDeleteProvider). */}
      <ConfirmDialog
        open={deleteRecordOpen}
        onOpenChange={setDeleteRecordOpen}
        title={t('books.record.deleteTitle', { ref: bidi(book.ref_number) })}
        description={t('books.record.deleteBody')}
        confirmLabel={deleteLabel}
        destructive
        onConfirm={() => {
          setDeleteRecordOpen(false)
          scheduleDelete([{ id: book.id, ref: book.ref_number }])
          onDeleted(book.id)
        }}
      />

      {/* Delete a scan / unfile a signed copy (books.edit). A signed copy warns
          that it reverts the record's approval. */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={
          deleteTarget?.kind === 'signed'
            ? t('books.pane.unfileSignedTitle')
            : t('books.pane.deletePaperTitle')
        }
        description={
          deleteTarget?.kind === 'signed'
            ? t('books.pane.unfileSignedBody')
            : t('books.pane.deletePaperBody')
        }
        confirmLabel={
          deleteTarget?.kind === 'signed'
            ? t('books.pane.unfileSignedConfirm')
            : t('common.delete')
        }
        onConfirm={() => {
          const p = deleteTarget
          setDeleteTarget(null)
          if (p) void manage.deletePaper(p)
        }}
      />

      {/* Replace a scan / signed copy: the target paper is captured, then this
          hidden input is clicked from the viewer's Replace button. */}
      <input
        ref={replaceRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          const p = replaceTarget
          setReplaceTarget(null)
          if (f && p) void manage.replacePaper(p, f)
          e.target.value = ''
        }}
      />

      <AlertDialog open={draftScan !== null} onOpenChange={(o) => { if (!o) setDraftScan(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('books.pane.signedCopyTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('books.pane.signedCopyBody', { ref: bidi(book.ref_number) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDraftScan(null)}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                const f = draftScan
                setDraftScan(null)
                if (f) void addScan.fileToCurrent(f, book.ref_number)
              }}
            >
              {t('books.pane.justAttach')}
            </Button>
            <AlertDialogAction
              onClick={() => {
                const f = draftScan
                setDraftScan(null)
                if (f) void addScan.fileSignedCopy(f, book.ref_number)
              }}
            >
              {t('books.pane.approveSignedCopy')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {fullOpen && selectedPaper
        ? createPortal(
            <div
              ref={overlayRef}
              role="dialog"
              aria-modal="true"
              aria-label={t('books.pane.fullPreview')}
              tabIndex={-1}
              className="fixed inset-0 z-50 flex flex-col bg-[rgba(10,14,24,0.78)] pt-3 focus:outline-none"
              onClick={(e) => {
                if (e.target === e.currentTarget) setFullOpen(false)
              }}
            >
              <Suspense fallback={null}>
                <RecordPaperViewer
                  papers={papers}
                  selectedKey={selectedKey}
                  onSelectKey={setPickedKey}
                  mode="overlay"
                  onClose={() => setFullOpen(false)}
                  {...deletePaperHandlers}
                />
              </Suspense>
            </div>,
            document.body,
          )
        : null}
    </aside>
  )
}

/** Saves a paper through a transient anchor (the same `download` the viewer uses). */
function downloadPaper(paper: Paper): void {
  const a = document.createElement('a')
  a.href = paper.downloadUrl
  a.download = paper.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function paneBtnClass({
  primary,
  iconOnly = false,
  blocked = false,
}: {
  primary: boolean
  iconOnly?: boolean
  blocked?: boolean
}): string {
  return cn(
    'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[0.74em] font-semibold transition-colors motion-reduce:transition-none',
    'min-h-8 pointer-coarse:min-h-11',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
    blocked && 'opacity-60',
    primary
      ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
      : 'border border-border text-muted-foreground hover:border-primary hover:text-primary',
    iconOnly && 'h-8 w-8 justify-center p-0',
  )
}

export function PaneBtn({
  primary = false,
  disabled = false,
  iconOnly = false,
  label,
  onClick,
  shortcut,
  reason,
  pending = false,
  pendingLabel,
  children,
}: {
  primary?: boolean
  disabled?: boolean
  iconOnly?: boolean
  label?: string
  onClick?: () => void
  /** Tooltip key + `aria-keyshortcuts`. */
  shortcut?: string
  /** Why it's unavailable: `aria-disabled` (still focusable, click no-op); tooltip on
   *  desktop, visible helper line on touch. */
  reason?: string
  /** Spinner + `aria-busy`; children swap to `pendingLabel` when given. */
  pending?: boolean
  pendingLabel?: string
  children: React.ReactNode
}): React.JSX.Element {
  const isMobile = useIsMobile()
  const reasonId = useId()
  const blocked = Boolean(reason) || pending
  const touchReason = Boolean(reason) && isMobile
  const hintLabel = reason ? (isMobile ? undefined : reason) : iconOnly || shortcut ? label : undefined
  const button = (
    <button
      type="button"
      disabled={disabled}
      onClick={blocked ? undefined : onClick}
      aria-disabled={blocked ? true : undefined}
      aria-busy={pending ? true : undefined}
      aria-keyshortcuts={shortcut}
      aria-describedby={touchReason ? reasonId : undefined}
      aria-label={iconOnly ? label : undefined}
      className={paneBtnClass({ primary, iconOnly, blocked })}
    >
      {pending ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {iconOnly ? null : (pendingLabel ?? children)}
        </>
      ) : (
        children
      )}
    </button>
  )
  const withHint = hintLabel ? (
    <Hint label={hintLabel} shortcut={reason ? undefined : shortcut} side="bottom">
      {button}
    </Hint>
  ) : (
    button
  )
  if (!touchReason) return withHint
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      {withHint}
      <span id={reasonId} className="max-w-[14rem] text-[0.7em] leading-tight text-muted-foreground">
        {reason}
      </span>
    </span>
  )
}
