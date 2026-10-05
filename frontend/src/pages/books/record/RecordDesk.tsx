/**
 * RecordDesk — the paper area: the PDF canvas with its annotation host, the
 * empty states, and the phone inline decide panel.
 */

import { Suspense, lazy, useCallback, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Maximize2 } from 'lucide-react'
import { RecordDecisionActions } from '../RecordDecisionActions'
import { BookAnnotationLayer, MarkTools, MarksStepper } from '@/components/books/BookAnnotationLayer'
import type { AnnotationKind } from '@/components/books/annotation-utils'
import { DocumentState } from '@/components/books/DocumentState'
import { WordSessionBanner } from '@/components/books/WordSessionBanner'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { api } from '@/lib/api'
import { useLocalStorage } from '@/lib/useLocalStorage'
import { useShortcutAction } from '@/lib/useKeyboardShortcuts'
import { cn } from '@/lib/utils'
import { defaultPaperKey, paperKey, papersOf, type Paper, type PaperKey } from '../recordPapers'
import { paperLabels } from '../recordPaperLabels'
import { DeskToolbar, PaperSwitcher, type PaperCaption } from './DeskToolbar'
import { FullscreenViewer } from './FullscreenViewer'
import type { RecordPieceProps } from './recordActions'
import { useRecordChrome } from './RecordChrome'

const DocPdfCanvas = lazy(() => import('@/pages/application/DocPdfCanvas'))

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

export function DecisionReasonForm({
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

/** A4 at 96 dpi: the pixel width zoom 100% stands for. */
const PAPER_ACTUAL_PX = 794
const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const ZOOM_STEP = 0.25
const ZOOM_STORAGE_KEY = 'gssg.books.record.zoom'

type Zoom = 'fit' | number

function sanitizeZoom(value: unknown): Zoom {
  return typeof value === 'number' && value >= MIN_ZOOM && value <= MAX_ZOOM ? value : 'fit'
}

/** The signed copy's caption date: numeric `YYYY-MM-DD`, the same shape as the header meta and status lines. */
function signedDateLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const day = iso.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

export function RecordDesk({ book, caps, view, actions }: RecordPieceProps): React.JSX.Element {
  const { t } = useTranslation()
  const chrome = useRecordChrome()
  const [searchParams, setSearchParams] = useSearchParams()
  const { isInmateReporter, canRevise } = caps
  const { isMobile, isAr, isPending, action, decision, busy, current, liveVersion, pdfUrl, userId, armed, annotatable, annMode, annotations, markBusy, decisionReasonFormProps } = view
  const { setArmedFor, handleRevise, requestSignConfirm, openMobileDecision, createMark, deleteMark, onPdfReady, mobileInlineSignRef, decisionPanelRef, panelReturnButtonRef, panelRejectButtonRef } = actions
  const dir = isAr ? 'rtl' : 'ltr'
  const bookId = book?.id

  // --- papers -------------------------------------------------------------
  // One list feeds the toolbar switcher, the phone chips and the full-screen
  // viewer, so an inmate reporter never sees a scan or an original=true paper
  // anywhere. An older revision the reader pinned shows just that revision's PDF.
  const viewingLive = !current || !liveVersion || current.version_no === liveVersion.version_no
  const papers = useMemo<Paper[]>(() => {
    if (!book) return []
    if (!viewingLive) {
      return pdfUrl
        ? [{ kind: 'generated', url: pdfUrl, downloadUrl: pdfUrl, filename: `${book.ref_number}.pdf`, isPdf: true }]
        : []
    }
    return papersOf(book, { inmateReporter: isInmateReporter })
  }, [book, viewingLive, pdfUrl, isInmateReporter])
  const labels = useMemo(() => paperLabels(t, papers), [t, papers])

  // `?paper=` selects by key on THIS record only (never carried by J/K); a key
  // that is not on the list (stale link, inmate reporter) falls back to the default.
  const paramKey = searchParams.get('paper')
  const selectedKey: PaperKey | null =
    papers.find((p) => paperKey(p) === paramKey) !== undefined
      ? (paramKey as PaperKey)
      : book
        ? defaultPaperKey(book, papers)
        : null
  const selectedPaper = papers.find((p) => paperKey(p) === selectedKey)
  const selectKey = useCallback(
    (key: PaperKey): void => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('paper', key)
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  // --- Word session: the preview is the last saved version; the live draft is opt-in, never polled ---
  const sessionBook = book && !book.voided_at && book.edit_session?.state === 'active' ? book : undefined
  const session = sessionBook?.edit_session
  const canShowLive = !!sessionBook && caps.canEdit && sessionBook.access_scope !== 'assigned_revision'
  const [liveFor, setLiveFor] = useState<number | null>(null)
  const liveActive = canShowLive && liveFor === bookId
  const liveUrl =
    liveActive && sessionBook && session
      ? api.wordSessionPreviewUrl(sessionBook.id, session.last_put_at ?? session.created_at)
      : null

  // --- what is on the desk ------------------------------------------------
  const deskUrl = liveUrl ?? (selectedPaper?.isPdf ? selectedPaper.url : null)
  const onGenerated = !liveActive && selectedPaper?.kind === 'generated'
  const markable = annotatable && onGenerated
  const showTools = markable && annMode === 'mark' && armed

  const [zoomStored, setZoomStored] = useLocalStorage<unknown>(ZOOM_STORAGE_KEY, 'fit')
  const zoom = sanitizeZoom(zoomStored)
  const setZoom = (next: Zoom): void => setZoomStored(next)
  const paperRef = useRef<HTMLDivElement | null>(null)
  const canZoom = !isMobile && deskUrl !== null
  const stepZoom = (direction: 1 | -1): void => {
    const base =
      zoom !== 'fit'
        ? zoom
        : (paperRef.current?.getBoundingClientRect().width ?? PAPER_ACTUAL_PX) / PAPER_ACTUAL_PX
    const next =
      direction === 1
        ? Math.ceil((base + 0.001) / ZOOM_STEP) * ZOOM_STEP
        : Math.floor((base - 0.001) / ZOOM_STEP) * ZOOM_STEP
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)))
  }

  const hasDocument = papers.length > 0 || liveActive
  useShortcutAction('focusDocument', () => {
    if (!hasDocument) return false
    if (isMobile) chrome.setFullscreen(!chrome.fullscreen)
    else chrome.setFocus(!chrome.focus)
  })
  useShortcutAction('zoomIn', () => (canZoom ? stepZoom(1) : false))
  useShortcutAction('zoomOut', () => (canZoom ? stepZoom(-1) : false))
  useShortcutAction('zoomFit', () => (canZoom ? setZoom('fit') : false))

  // --- annotation tools / stepper state (shared by the toolbar and the layer) ---
  const [tool, setTool] = useState<AnnotationKind>('pin')
  const [openMark, setOpenMark] = useState<{ bookId: number | undefined; id: number | null }>({ bookId, id: null })
  const openMarkId = openMark.bookId === bookId ? openMark.id : null
  const setOpenMarkId = (id: number | null): void => setOpenMark({ bookId, id })

  // --- page counter -------------------------------------------------------
  const [pageInfo, setPageInfo] = useState<{ url: string; page: number; total: number } | null>(null)
  const page = pageInfo && pageInfo.url === deskUrl ? pageInfo : null

  // --- caption ------------------------------------------------------------
  const signedDate = signedDateLabel(view.currentSteps.find((s) => s.state === 'approved')?.decided_at)
  let caption: PaperCaption | null = null
  if (liveActive) caption = { text: t('books.paper.live'), ok: false }
  else if (selectedPaper?.kind === 'signed') {
    if (signedDate) {
      const marker = '\uE000'
      const [before, after = ''] = t('books.paper.captionSigned', { date: marker }).split(marker)
      caption = {
        text: (
          <>
            {before}
            <bdi dir="ltr" className="tabular-nums">{signedDate}</bdi>
            {after}
          </>
        ),
        ok: true,
      }
    }
  } else if (selectedPaper && selectedPaper.kind !== 'scan') {
    if (view.state === 'awaiting_scan') caption = { text: t('books.paper.captionAwaitingScan'), ok: false }
    else if (view.state === 'pending') caption = { text: t('books.paper.captionPending'), ok: false }
    else if (view.state === 'none') caption = { text: t('books.paper.captionDraft'), ok: false }
  }

  const marksSlot = markable ? (
    <MarksStepper annotations={annotations} openId={openMarkId} onOpenIdChange={setOpenMarkId} />
  ) : null
  const toolsSlot = showTools ? (
    <span className="inline-flex items-center rounded-[11px] bg-primary-soft px-2 py-0.5 text-primary">
      <MarkTools tool={tool} onToolChange={setTool} />
    </span>
  ) : null

  const wordBanner = sessionBook ? (
    <div data-print-hide className="mx-auto mb-3 w-full max-w-[var(--paper-w)] shrink-0">
      <WordSessionBanner
        book={sessionBook}
        live={liveActive}
        onToggleLive={canShowLive ? () => setLiveFor(liveActive ? null : (bookId ?? null)) : undefined}
      />
    </div>
  ) : null

  const paperStyle: React.CSSProperties =
    zoom === 'fit' || isMobile
      ? { width: '100%', maxWidth: 'var(--paper-w)' }
      : { width: Math.round(PAPER_ACTUAL_PX * zoom) }

  let paperBody: React.ReactNode
  if (deskUrl !== null) {
    paperBody = (
      <Suspense fallback={<DocumentState kind="loading" />}>
        <DocPdfCanvas
          pdfUrl={deskUrl}
          docxUrl={onGenerated || liveActive ? (current?.docx_url ?? undefined) : undefined}
          sizing="fit"
          bare
          onReady={onPdfReady}
          onPageChange={(p, total) => setPageInfo({ url: deskUrl, page: p, total })}
          renderOverlay={
            markable
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
                      currentUserId={userId}
                      busy={markBusy}
                      tool={tool}
                      onToolChange={setTool}
                      openId={openMarkId}
                      onOpenIdChange={setOpenMarkId}
                      onCreate={(m) => createMark(m)}
                      onDelete={(id) => deleteMark(id)}
                      onDisarm={() => setArmedFor(null)}
                    />
                  </div>
                )
              : undefined
          }
        />
      </Suspense>
    )
  } else if (selectedPaper) {
    // An image scan: no pages, nothing to zoom by key — it fills the paper width.
    paperBody = (
      <img src={selectedPaper.url} alt={selectedPaper.filename} draggable={false} className="block w-full rounded-lg bg-white shadow-lg" />
    )
  } else if (isPending) {
    paperBody = <DocumentState kind="loading" />
  } else if (!isInmateReporter && book?.imported_doc) {
    // Imported record whose vault file isn't a PDF (e.g. .docx) — no
    // inline preview, so offer the original for download.
    paperBody = (
      <DocumentState
        kind="empty"
        title={t('books.record.importedNoPreview')}
        body=""
        action={
          <a
            href={book.imported_doc.download_url}
            download={book.imported_doc.filename}
            className={buttonVariants({ size: 'sm' })}
          >
            {t('books.record.downloadImported', { format: book.imported_doc.format.toUpperCase() })}
          </a>
        }
      />
    )
  } else if (book?.edit_session?.state === 'active') {
    // The body is still being written in Word — there is genuinely no
    // document yet, but that's expected, not an error; the Word-session
    // controls (Finish editing / Discard) are already visible above.
    paperBody = <DocumentState kind="empty" title={t('books.word.bodyInWord')} body="" />
  } else if (action === 'revise' && canRevise) {
    // A returned/rejected record whose document isn't on file (or was
    // removed) — the one real recovery already available from this
    // page is the same Revise action the workflow bar offers.
    paperBody = (
      <DocumentState
        kind="empty"
        title={t('books.record.noDocument')}
        body=""
        action={
          <Button type="button" size="sm" onClick={handleRevise}>
            {t('books.versions.revise')}
          </Button>
        }
      />
    )
  } else {
    // Nothing produced this document and no action on this page would
    // fix that — submitting doesn't create one, so no CTA is offered.
    paperBody = <DocumentState kind="empty" title={t('books.record.noDocument')} body="" />
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col md:border-e md:border-hairline">
      <DeskToolbar
        dir={dir}
        papers={papers}
        labels={labels}
        selectedKey={selectedKey}
        onSelect={selectKey}
        paper={liveActive ? undefined : selectedPaper}
        caption={caption}
        page={page}
        zoom={zoom}
        zoomable={deskUrl !== null}
        onZoomIn={() => stepZoom(1)}
        onZoomOut={() => stepZoom(-1)}
        onFit={() => setZoom('fit')}
        onActualSize={() => setZoom(1)}
        marks={marksSlot}
        tools={toolsSlot}
        focus={chrome.focus}
        onToggleFocus={() => chrome.setFocus(!chrome.focus)}
      />

      <div
        data-record-desk
        className="flex min-h-0 flex-1 flex-col overflow-auto px-6 py-6 [--paper-w:100%] max-md:px-3 max-md:py-3 max-md:pb-[calc(4.5rem+var(--safe-bottom))] lg:[--paper-w:760px] xl:[--paper-w:880px] min-[1920px]:[--paper-w:1000px]"
        style={{
          background:
            'radial-gradient(150% 100% at 40% -10%, var(--surface) 0%, var(--surface-tinted) 70%, var(--bg) 100%)',
        }}
      >
        {/* phone: 44px chip row (switcher · Expand), caption, marks, armed tools */}
        {hasDocument && (
          <div dir={dir} data-print-hide className="mb-2.5 flex flex-col gap-2 md:hidden">
            {papers.length > 1 ? (
              <PaperSwitcher
                papers={papers}
                labels={labels}
                selectedKey={selectedKey}
                onSelect={selectKey}
                variant="chips"
              />
            ) : null}
            {caption?.text ? (
              <span className={cn('text-[0.8em]', caption.ok ? 'font-semibold text-success' : 'text-muted-foreground')}>
                {caption.text}
              </span>
            ) : null}
            {marksSlot || toolsSlot ? (
              <div className="flex flex-wrap items-center gap-2">
                {marksSlot}
                {toolsSlot}
              </div>
            ) : null}
          </div>
        )}

        {wordBanner}

        <div
          ref={paperRef}
          data-record-paper
          className="print-paper relative mx-auto shrink-0"
          style={paperStyle}
        >
          {deskUrl !== null || selectedPaper ? (
            <button
              type="button"
              data-print-hide
              onClick={() => chrome.setFullscreen(true)}
              className="absolute end-2 top-2 z-10 inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-surface/90 px-3 text-[0.8em] font-semibold text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            >
              <Maximize2 className="h-[1.0625rem] w-[1.0625rem]" aria-hidden />
              {t('books.record.expand')}
            </button>
          ) : null}
          {paperBody}
        </div>

        {isMobile && action === 'decide' && (
          <div
            ref={decisionPanelRef}
            dir={dir}
            data-print-hide
            className="mx-auto mt-5 w-full md:hidden"
          >
            <RecordDecisionActions
              returnButtonRef={panelReturnButtonRef}
              rejectButtonRef={panelRejectButtonRef}
              signButtonRef={mobileInlineSignRef}
              busy={busy}
              pending={view.pendingAct}
              onSign={() => requestSignConfirm(mobileInlineSignRef)}
              onReturn={() => openMobileDecision('return')}
              onReject={() => openMobileDecision('reject')}
            />
            {decision !== null && (
              <div className="mt-3 rounded-xl border border-hairline bg-surface p-3.5">
                <DecisionReasonForm {...decisionReasonFormProps} act={decision} />
              </div>
            )}
          </div>
        )}
      </div>

      {chrome.fullscreen && papers.length > 0 && (
        <FullscreenViewer
          papers={papers}
          labels={labels}
          selectedKey={selectedKey}
          onSelect={selectKey}
          onClose={() => chrome.setFullscreen(false)}
          docxUrl={current?.docx_url ?? undefined}
        />
      )}
    </div>
  )
}
