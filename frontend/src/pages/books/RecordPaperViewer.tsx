/**
 * Film-strip paper viewer for the Records pane (design locked off
 * docs/prototypes/records-redesign-2026-06-10/final-records.html).
 *
 * - One strip frame per Paper (generated / signed / scan) + an "Add scan"
 *   frame (caps-gated by the parent via addScanSlot).
 * - PDF bytes fetched as ?encoding=base64 text (IDM bypass — DocPdfCanvas
 *   pattern); images load as plain <img>.
 * - Zoom 60–240% re-renders pdf.js pages at baseWidth×zoom so the scroll
 *   container overflows naturally; grab-to-pan via pointer capture.
 * - Full preview = the parent renders this same component with isOverlay +
 *   a larger baseWidth inside a fixed overlay.
 *
 * Lazy-loaded by the page (default export) so pdf.js ships in its own chunk.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Loader2, Maximize2, Minus, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import { cn } from '@/lib/utils'

import type { Paper } from './recordPapers'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

function toBase64Url(url: string): string {
  return url.includes('?') ? `${url}&encoding=base64` : `${url}?encoding=base64`
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

/** Renders one paper (PDF pages stacked, or an image) at `width` px. */
function PaperCanvas({ paper, width }: { paper: Paper; width: number }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (!paper.isPdf) {
      queueMicrotask(() => setStatus('ready'))
      return
    }
    let cancelled = false
    const host = hostRef.current
    void (async () => {
      try {
        setStatus('loading')
        const res = await fetch(toBase64Url(paper.url))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = base64ToBytes(await res.text())
        if (cancelled || !host) return
        const pdf = await pdfjsLib.getDocument({ data, disableFontFace: true }).promise
        if (cancelled) return
        host.replaceChildren()
        for (let n = 1; n <= pdf.numPages; n += 1) {
          const page = await pdf.getPage(n)
          if (cancelled) return
          const base = page.getViewport({ scale: 1 })
          const dpr = window.devicePixelRatio || 1
          const scale = (width / base.width) * dpr
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.width = `${width}px`
          canvas.style.display = 'block'
          canvas.style.marginBottom = '12px'
          canvas.style.boxShadow = '0 2px 8px rgba(13,40,69,.18)'
          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          await page.render({
            canvas,
            canvasContext: ctx,
            viewport,
          }).promise
          if (cancelled) return
          host.appendChild(canvas)
        }
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [paper, width])

  if (!paper.isPdf) {
    return <img src={paper.url} alt={paper.filename} style={{ width }} className="block shadow-md" draggable={false} />
  }
  return (
    <div>
      {status === 'loading' && (
        <div className="grid place-items-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        </div>
      )}
      {status === 'error' && (
        <div className="py-10 text-center text-[0.78em] text-accent">{paper.filename}</div>
      )}
      <div ref={hostRef} />
    </div>
  )
}

export function RecordPaperViewer({
  papers,
  paperIndex,
  onPaperIndexChange,
  baseWidth,
  isOverlay = false,
  onOpenFull,
  onClose,
  addScanSlot,
  emptySlot,
}: {
  papers: Paper[]
  paperIndex: number
  onPaperIndexChange: (i: number) => void
  /** page width in px at 100% zoom */
  baseWidth: number
  isOverlay?: boolean
  onOpenFull?: () => void
  onClose?: () => void
  /** parent-provided "＋ Add scan" strip frame (caps-gated) */
  addScanSlot?: React.ReactNode
  /** parent-provided empty state when papers.length === 0 */
  emptySlot?: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  const [zoom, setZoom] = useState(1)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const panState = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false })
  const [canPan, setCanPan] = useState(false)
  const [grabbing, setGrabbing] = useState(false)

  const paper = papers[paperIndex] as Paper | undefined
  const paperKey = paper?.url
  const [prevPaperKey, setPrevPaperKey] = useState(paperKey)
  if (prevPaperKey !== paperKey) {
    setPrevPaperKey(paperKey)
    setZoom(1)
  }

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
  }, [zoom, paperIndex, papers, measureOverflow])

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

  const kindLabel = (p: Paper): string =>
    p.kind === 'generated'
      ? t('books.pane.generated')
      : p.kind === 'signed'
        ? t('books.pane.signedCopy')
        : t('books.pane.scan')

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', isOverlay && 'h-full')}>
      {!isOverlay && (papers.length > 0 || addScanSlot) && (
        <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-hairline bg-surface-raised px-3 py-2.5">
          {papers.map((p, i) => (
            <button
              key={`${p.kind}-${p.url}`}
              type="button"
              aria-pressed={i === paperIndex}
              onClick={() => onPaperIndexChange(i)}
              className="flex w-14 shrink-0 flex-col items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn(
                  'grid aspect-[210/297] w-full place-items-center overflow-hidden rounded-[3px] border-2 bg-surface font-mono text-[0.56em] text-faint transition-colors',
                  i === paperIndex ? 'border-primary' : 'border-border',
                )}
              >
                {p.isPdf ? 'PDF' : 'IMG'}
              </span>
              <span
                className={cn(
                  'w-full truncate text-center text-[0.56em] leading-tight',
                  i === paperIndex ? 'font-bold text-primary' : 'text-muted-foreground',
                )}
              >
                {kindLabel(p)}
              </span>
            </button>
          ))}
          {addScanSlot}
        </div>
      )}

      {paper && (
        <div
          className={cn(
            'flex shrink-0 items-center gap-1 px-3 py-1.5',
            isOverlay ? 'justify-center' : 'border-b border-hairline bg-surface-raised',
          )}
        >
          <span
            className={cn(
              'truncate font-mono text-[0.66em]',
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
            className={cn(
              'min-w-[3rem] text-center font-mono text-[0.66em] tabular-nums',
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
              'inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[0.66em] font-semibold transition-colors',
              isOverlay
                ? 'bg-white/15 text-white hover:bg-white/25'
                : 'border border-hairline bg-surface text-muted-foreground hover:border-primary hover:text-primary',
            )}
          >
            <Download className="h-3 w-3" aria-hidden />
            {t('common.download')}
          </a>
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
          {paper ? <PaperCanvas paper={paper} width={Math.round(baseWidth * zoom)} /> : (emptySlot ?? null)}
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
  children,
}: {
  isOverlay: boolean
  label: string
  onClick: () => void
  text?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[0.66em] font-semibold transition-colors',
        isOverlay
          ? 'bg-white/15 text-white hover:bg-white/25'
          : 'border border-hairline bg-surface text-muted-foreground hover:border-primary hover:text-primary',
      )}
    >
      {children}
      {text}
    </button>
  )
}

export default RecordPaperViewer
