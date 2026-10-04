/**
 * Film-strip paper viewer for the Records pane (design locked off
 * docs/prototypes/records-redesign-2026-06-10/final-records.html).
 *
 * - One strip frame per Paper (signed / original / imported / scan) with a
 *   cached first-page thumbnail and a page-count badge, + an "Add scan" frame
 *   (caps-gated by the parent via addScanSlot). The strip is hidden when there
 *   is one paper and nothing to add.
 * - PDF documents come from `lib/pdfDocCache` (zoom and paper switches never
 *   refetch); pages are lazy aspect-correct placeholders (`PdfPages`) painted
 *   at the displayed width — a CSS scale first, then a debounced re-raster.
 *   Images load as plain <img>.
 * - Fit = the viewer's own container width minus padding (ResizeObserver);
 *   zoom 60–240% scales that, so the scroll container overflows naturally;
 *   grab-to-pan via pointer capture.
 * - `mode` picks the chrome: 'pane' (strip + light toolbar), 'overlay'
 *   (full preview, dark toolbar with the paper switcher) or 'dialog'
 *   (approvals preview, dark toolbar; the strip appears only when there is more
 *   than one paper).
 *
 * Lazy-loaded by the page (default export) so pdf.js ships in its own chunk.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Download, FileText, Maximize2, MoreHorizontal, Minus, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { DocumentState } from '@/components/books/DocumentState'
import { documentErrorKind } from '@/components/books/documentState'
import { PdfPages } from '@/components/books/PdfPages'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Hint } from '@/components/ui/hint'
import { leasePdfUrl, type PdfDocLease } from '@/lib/pdfDocCache'
import { cn } from '@/lib/utils'

import { paperKey, type Paper, type PaperKey } from './recordPapers'
import { paperLabels } from './recordPaperLabels'

/** Horizontal padding (px) around the page inside the scroll container (`p-4` × 2). */
const PAPER_PADDING = 32
/** Below this container width Replace / Delete collapse into a ⋯ menu. */
const NARROW_TOOLBAR = 420

export type RecordPaperViewerMode = 'pane' | 'overlay' | 'dialog'

type DocState =
  | { kind: 'loading' }
  | { kind: 'loaded'; doc: PDFDocumentProxy }
  | { kind: 'error'; error: unknown }

/** Renders one paper (PDF pages stacked, or an image) at `width` px. */
function PaperCanvas({ paper, width }: { paper: Paper; width: number }): React.JSX.Element {
  if (!paper.isPdf) {
    return <img src={paper.url} alt={paper.filename} style={{ width }} className="block shadow-md" draggable={false} />
  }
  return <PdfPaper key={paper.url} url={paper.url} width={width} />
}

function PdfPaper({ url, width }: { url: string; width: number }): React.JSX.Element {
  const [state, setState] = useState<DocState>({ kind: 'loading' })
  // Retry bumps this; a failed load is never cached, so the effect refetches.
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let lease: PdfDocLease | null = null
    leasePdfUrl(url, controller.signal).then(
      (l) => {
        lease = l
        setState({ kind: 'loaded', doc: l.doc })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: 'error', error })
      },
    )
    return () => {
      controller.abort()
      lease?.release()
    }
  }, [url, nonce])

  if (state.kind === 'loading') {
    return <DocumentState kind="loading" className="min-h-[160px]" />
  }
  if (state.kind === 'error') {
    const kind = documentErrorKind(state.error)
    return (
      <DocumentState
        kind={kind}
        className="min-h-[200px]"
        openUrl={url}
        onRetry={
          kind === 'error'
            ? () => {
                setState({ kind: 'loading' })
                setNonce((n) => n + 1)
              }
            : undefined
        }
      />
    )
  }
  return (
    <PdfPages
      doc={state.doc}
      sizing={{ kind: 'width', px: width }}
      pageClassName="shadow-[0_2px_8px_rgba(13,40,69,.18)]"
      onError={(error) => setState({ kind: 'error', error })}
    />
  )
}

// ---------------------------------------------------------------------------
// Thumbnails (cached first page + page count)

interface ThumbInfo {
  src: string | null
  pages: number | null
}
const THUMB_CACHE_MAX = 40
const thumbCache = new Map<string, ThumbInfo>()
const THUMB_WIDTH = 64

function rememberThumb(url: string, info: ThumbInfo): void {
  thumbCache.delete(url)
  thumbCache.set(url, info)
  if (thumbCache.size > THUMB_CACHE_MAX) {
    const oldest = thumbCache.keys().next().value
    if (oldest !== undefined) thumbCache.delete(oldest)
  }
}

async function buildThumb(url: string, signal: AbortSignal): Promise<ThumbInfo> {
  const lease = await leasePdfUrl(url, signal)
  try {
    const page = await lease.doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = (THUMB_WIDTH * Math.min(window.devicePixelRatio || 1, 2)) / base.width
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return { src: null, pages: lease.doc.numPages }
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    return { src: canvas.toDataURL('image/jpeg', 0.7), pages: lease.doc.numPages }
  } finally {
    lease.release()
  }
}

function useThumb(paper: Paper): ThumbInfo | null {
  const [, force] = useState(0)
  const url = paper.url
  const isPdf = paper.isPdf
  const cached = thumbCache.get(url)
  useEffect(() => {
    if (!isPdf || thumbCache.has(url)) return
    const controller = new AbortController()
    buildThumb(url, controller.signal).then(
      (info) => {
        rememberThumb(url, info)
        force((n) => n + 1)
      },
      () => {
        // A thumbnail is decoration: fall back to the file icon.
      },
    )
    return () => controller.abort()
  }, [url, isPdf])
  return isPdf ? (cached ?? null) : { src: url, pages: null }
}

function PaperThumb({
  paper,
  label,
  active,
  onSelect,
}: {
  paper: Paper
  label: string
  active: boolean
  onSelect: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const thumb = useThumb(paper)
  const button = (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className="flex w-16 shrink-0 flex-col items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
    >
      <span
        className={cn(
          'relative grid aspect-[210/297] w-full place-items-center overflow-hidden rounded-[3px] border-2 bg-surface text-faint transition-colors motion-reduce:transition-none',
          active ? 'border-primary' : 'border-border',
        )}
      >
        {thumb?.src ? (
          <img src={thumb.src} alt="" draggable={false} className="h-full w-full object-cover object-top" />
        ) : (
          <FileText className="h-5 w-5" strokeWidth={1.6} aria-hidden />
        )}
        {thumb?.pages != null && thumb.pages > 1 ? (
          <span className="absolute bottom-0.5 end-0.5 rounded bg-foreground/80 px-1 text-[0.6875rem] font-semibold leading-tight text-background">
            <bdi dir="ltr" className="tabular-nums">
              {t('books.paper.pages', { count: thumb.pages })}
            </bdi>
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          'w-full truncate text-center text-[0.6875rem] leading-tight',
          active ? 'font-bold text-primary' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
    </button>
  )
  // A scan's own filename is the only way to tell two scans apart.
  return paper.kind === 'scan' ? <Hint label={paper.filename}>{button}</Hint> : button
}

// ---------------------------------------------------------------------------

export function RecordPaperViewer({
  papers,
  selectedKey,
  onSelectKey,
  mode,
  onOpenFull,
  onClose,
  addScanSlot,
  emptySlot,
  onDeletePaper,
  onReplacePaper,
}: {
  papers: Paper[]
  /** key of the selected paper; falls back to the first paper when absent */
  selectedKey: PaperKey | null
  onSelectKey: (key: PaperKey) => void
  mode: RecordPaperViewerMode
  onOpenFull?: () => void
  onClose?: () => void
  /** parent-provided "＋ Add scan" strip frame (caps-gated) */
  addScanSlot?: React.ReactNode
  /** parent-provided empty state when papers.length === 0 */
  emptySlot?: React.ReactNode
  /** request delete of a scan/signed paper (parent shows confirm + calls the API) */
  onDeletePaper?: (paper: Paper) => void
  /** request replace of a scan/signed paper (parent opens a file picker) */
  onReplacePaper?: (paper: Paper) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const isOverlay = mode !== 'pane'
  const [zoom, setZoom] = useState(1)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const panState = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false })
  const [canPan, setCanPan] = useState(false)
  const [grabbing, setGrabbing] = useState(false)

  const paper = papers.find((p) => paperKey(p) === selectedKey) ?? papers[0]
  const activeKey = paper ? paperKey(paper) : null
  const [prevActiveKey, setPrevActiveKey] = useState(activeKey)
  if (prevActiveKey !== activeKey) {
    setPrevActiveKey(activeKey)
    setZoom(1)
  }

  // Fit width = this container's own width minus padding.
  useLayoutEffect(() => {
    const el = canvasRef.current
    if (!el) return
    setContainerWidth(Math.round(el.clientWidth))
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth
      setContainerWidth(Math.round(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fitWidth = Math.max(0, containerWidth - PAPER_PADDING)
  const narrow = containerWidth > 0 && containerWidth < NARROW_TOOLBAR
  const showStrip =
    (mode === 'pane' && (papers.length > 1 || !!addScanSlot)) ||
    (mode === 'dialog' && papers.length > 1)
  const labels = paperLabels(t, papers)
  const labelOf = (p: Paper): string => labels[papers.indexOf(p)] ?? ''

  const minZoom = isOverlay ? 0.5 : 0.6
  const maxZoom = isOverlay ? 3 : 2.4
  const step = isOverlay ? 0.25 : 0.2

  const measureOverflow = useCallback((): void => {
    const cv = canvasRef.current
    if (!cv) return
    setCanPan(cv.scrollWidth > cv.clientWidth + 2 || cv.scrollHeight > cv.clientHeight + 2)
  }, [])
  useEffect(() => {
    measureOverflow()
    const id = window.setTimeout(measureOverflow, 450) // after pdf render settles
    return () => window.clearTimeout(id)
  }, [zoom, activeKey, papers, containerWidth, measureOverflow])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const cv = canvasRef.current
    if (!cv || !canPan) return
    panState.current = { x: e.clientX, y: e.clientY, active: true }
    cv.setPointerCapture(e.pointerId)
    setGrabbing(true)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const cv = canvasRef.current
    if (!cv || !panState.current.active) return
    cv.scrollLeft -= e.clientX - panState.current.x
    cv.scrollTop -= e.clientY - panState.current.y
    panState.current.x = e.clientX
    panState.current.y = e.clientY
  }
  const endPan = (): void => {
    panState.current.active = false
    setGrabbing(false)
  }

  const manageable = paper && (paper.kind === 'scan' || paper.kind === 'signed')
  const canReplace = !!onReplacePaper && manageable
  const canDelete = !!onDeletePaper && manageable

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', isOverlay && 'h-full')}>
      {showStrip && (
        <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-hairline bg-surface-raised px-3 py-2.5">
          {papers.map((p) => (
            <PaperThumb
              key={paperKey(p)}
              paper={p}
              label={labelOf(p)}
              active={paperKey(p) === activeKey}
              onSelect={() => onSelectKey(paperKey(p))}
            />
          ))}
          {addScanSlot}
        </div>
      )}

      {paper && (
        <div
          className={cn(
            'flex shrink-0 flex-wrap items-center gap-1 px-3 py-1.5',
            isOverlay ? 'justify-center' : 'border-b border-hairline bg-surface-raised',
          )}
        >
          {mode === 'overlay' && papers.length > 1 && (
            <div role="group" aria-label={t('books.pane.papers', { count: papers.length })} className="flex flex-wrap gap-1">
              {papers.map((p) => (
                <button
                  key={paperKey(p)}
                  type="button"
                  aria-pressed={paperKey(p) === activeKey}
                  onClick={() => onSelectKey(paperKey(p))}
                  className={cn(
                    'inline-flex min-h-8 items-center rounded-sm px-2 text-[0.75em] font-semibold transition-colors motion-reduce:transition-none',
                    paperKey(p) === activeKey ? 'bg-white text-black' : 'bg-white/15 text-white hover:bg-white/25',
                  )}
                >
                  {labelOf(p)}
                </button>
              ))}
            </div>
          )}
          <span
            className={cn(
              'truncate font-mono text-[0.75em]',
              isOverlay ? 'max-w-[18rem] text-white/90' : 'min-w-0 flex-1 text-muted-foreground',
            )}
          >
            {paper.filename}
          </span>
          <ToolbarBtn
            isOverlay={isOverlay}
            label={t('books.pane.zoomOut')}
            onClick={() => setZoom((z) => Math.max(minZoom, +(z - step).toFixed(2)))}
          >
            <Minus className="h-3 w-3" aria-hidden />
          </ToolbarBtn>
          <span
            aria-live="polite"
            className={cn(
              'min-w-[3rem] text-center font-mono text-[0.75em] tabular-nums',
              isOverlay ? 'text-white' : 'text-muted-foreground',
            )}
          >
            {Math.round(zoom * 100)}%
          </span>
          <ToolbarBtn
            isOverlay={isOverlay}
            label={t('books.pane.zoomIn')}
            onClick={() => setZoom((z) => Math.min(maxZoom, +(z + step).toFixed(2)))}
          >
            <Plus className="h-3 w-3" aria-hidden />
          </ToolbarBtn>
          <ToolbarBtn
            isOverlay={isOverlay}
            label={t('books.pane.fit')}
            onClick={() => setZoom(1)}
            text={t('books.pane.fit')}
          />
          <a
            href={paper.downloadUrl}
            download={paper.filename}
            className={cn(
              'inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[0.75em] font-semibold transition-colors motion-reduce:transition-none',
              isOverlay
                ? 'bg-white/15 text-white hover:bg-white/25'
                : 'border border-hairline bg-surface text-muted-foreground hover:border-primary hover:text-primary',
            )}
          >
            <Download className="h-3 w-3" aria-hidden />
            {t('common.download')}
          </a>
          {narrow && (canReplace || canDelete) ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t('books.pane.more')}
                  className={cn(
                    'inline-flex items-center rounded-sm px-2 py-1 transition-colors motion-reduce:transition-none',
                    isOverlay
                      ? 'bg-white/15 text-white hover:bg-white/25'
                      : 'border border-hairline bg-surface text-muted-foreground hover:border-primary hover:text-primary',
                  )}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canReplace && (
                  <DropdownMenuItem onSelect={() => onReplacePaper(paper)}>
                    <RefreshCw className="h-4 w-4" aria-hidden />
                    {t('books.pane.replacePaper')}
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem variant="danger" onSelect={() => onDeletePaper(paper)}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                    {t('books.pane.deletePaper')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              {canReplace && (
                <ToolbarBtn
                  isOverlay={isOverlay}
                  label={t('books.pane.replacePaper')}
                  onClick={() => onReplacePaper(paper)}
                >
                  <RefreshCw className="h-3 w-3" aria-hidden />
                </ToolbarBtn>
              )}
              {canDelete && (
                <ToolbarBtn
                  isOverlay={isOverlay}
                  danger
                  label={t('books.pane.deletePaper')}
                  onClick={() => onDeletePaper(paper)}
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                </ToolbarBtn>
              )}
            </>
          )}
          {!isOverlay && onOpenFull && (
            <ToolbarBtn isOverlay={false} label={t('books.pane.fullPreview')} onClick={onOpenFull}>
              <Maximize2 className="h-3 w-3" aria-hidden />
            </ToolbarBtn>
          )}
          {isOverlay && onClose && (
            <ToolbarBtn isOverlay label={t('common.close')} onClick={onClose} text={t('common.close')}>
              <X className="h-3 w-3" aria-hidden />
            </ToolbarBtn>
          )}
        </div>
      )}

      <div
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        className={cn(
          'flex min-h-0 flex-1 overflow-auto',
          !isOverlay && 'bg-surface-tinted',
          canPan && (grabbing ? 'cursor-grabbing select-none' : 'cursor-grab'),
        )}
      >
        <div className="m-auto shrink-0 p-4">
          {paper ? (
            fitWidth > 0 ? (
              <PaperCanvas paper={paper} width={Math.round(fitWidth * zoom)} />
            ) : null
          ) : (
            (emptySlot ?? null)
          )}
        </div>
      </div>
    </div>
  )
}

function ToolbarBtn({
  isOverlay,
  label,
  onClick,
  text,
  danger = false,
  children,
}: {
  isOverlay: boolean
  label: string
  onClick: () => void
  text?: string
  /** destructive action: red, with its label as the hint */
  danger?: boolean
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <Hint label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cn(
          'inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[0.75em] font-semibold transition-colors motion-reduce:transition-none',
          danger
            ? isOverlay
              ? 'bg-accent/80 text-white hover:bg-accent'
              : 'border border-accent/40 bg-surface text-accent hover:bg-accent/10'
            : isOverlay
              ? 'bg-white/15 text-white hover:bg-white/25'
              : 'border border-hairline bg-surface text-muted-foreground hover:border-primary hover:text-primary',
        )}
      >
        {children}
        {text}
      </button>
    </Hint>
  )
}

export default RecordPaperViewer
