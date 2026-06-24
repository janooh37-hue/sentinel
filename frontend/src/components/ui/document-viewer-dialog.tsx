/**
 * DocumentViewerDialog — a generic, fully-local lightbox for files addressable
 * by URL. Images render via <img>; PDFs via the pdf.js canvas PdfViewer; other
 * types show a download-only fallback. Nothing is sent to any external service.
 *
 * Modeled on ledger/AttachmentPreviewDialog (portal, Escape/arrows, RTL). Future
 * work converges that dialog onto this one.
 */

import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Download, ExternalLink, Loader2, Maximize, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react'

import { FileTypeIcon } from '@/components/ledger/FileTypeIcon'
import type { FileKind } from '@/lib/fileTypes'

const PdfViewer = lazy(() => import('@/components/ledger/PdfViewer'))

export interface DocViewerItem {
  name: string
  kind: FileKind
  imageUrl?: string
  pdfBase64Url?: string
  openUrl?: string
  downloadUrl: string
}

export interface DocumentViewerDialogProps {
  items: DocViewerItem[]
  startIndex?: number
  onClose: () => void
}

function ViewerSpinner(): React.JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center text-white/70">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  )
}

const ZOOM_MIN = 0.25
const ZOOM_MAX = 4
const ZOOM_STEP = 0.25

export function DocumentViewerDialog({
  items,
  startIndex = 0,
  onClose,
}: DocumentViewerDialogProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const count = items.length
  const [index, setIndex] = useState(startIndex)
  const [imgError, setImgError] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [zoom, setZoom] = useState(1)

  const resetView = useCallback(() => {
    setRotation(0)
    setZoom(1)
  }, [])

  const go = useCallback(
    (delta: number) => {
      setImgError(false)
      resetView()
      setIndex((i) => Math.min(count - 1, Math.max(0, i + delta)))
    },
    [count, resetView],
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, go])

  const current = items[index]
  if (!current) return null

  const previewable = current.kind === 'image' || current.kind === 'pdf'

  const downloadFallback = (
    <div className="flex flex-col items-center gap-4 rounded-2xl bg-surface px-10 py-12 text-center">
      <FileTypeIcon kind={current.kind} size={56} />
      <p className="max-w-xs text-sm text-muted-foreground">
        {t('viewer.unavailable', { defaultValue: "Preview isn't available for this file type" })}
      </p>
      <a
        href={current.downloadUrl}
        download
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
      >
        <Download className="h-4 w-4" strokeWidth={1.7} />
        {t('common.download')}
      </a>
    </div>
  )

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('viewer.title', { defaultValue: 'Preview' })}
      onClick={onClose}
    >
      {/* Header */}
      <div
        className="mx-auto flex w-full max-w-5xl shrink-0 items-center gap-3 py-2 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="shrink-0">
          <FileTypeIcon kind={current.kind} size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" dir="auto" title={current.name}>
            {current.name}
          </div>
          {count > 1 && (
            <div className="font-mono text-xs tabular-nums text-white/60">
              {index + 1} / {count}
            </div>
          )}
        </div>
        {previewable && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setRotation((r) => (r + 90) % 360)}
            aria-label={t('viewer.rotate', { defaultValue: 'Rotate' })}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/20"
          >
            <RotateCw className="h-5 w-5" strokeWidth={1.8} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
            disabled={zoom <= ZOOM_MIN}
            aria-label={t('viewer.zoomOut', { defaultValue: 'Zoom out' })}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/20 disabled:opacity-30"
          >
            <ZoomOut className="h-5 w-5" strokeWidth={1.8} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
            disabled={zoom >= ZOOM_MAX}
            aria-label={t('viewer.zoomIn', { defaultValue: 'Zoom in' })}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/20 disabled:opacity-30"
          >
            <ZoomIn className="h-5 w-5" strokeWidth={1.8} aria-hidden />
          </button>
          <button
            type="button"
            onClick={resetView}
            aria-label={t('viewer.reset', { defaultValue: 'Fit / reset' })}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/20"
          >
            <Maximize className="h-5 w-5" strokeWidth={1.8} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => window.open(current.openUrl ?? current.downloadUrl, '_blank', 'noopener')}
            aria-label={t('viewer.openNewTab', { defaultValue: 'Open in new tab' })}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/20"
          >
            <ExternalLink className="h-5 w-5" strokeWidth={1.8} aria-hidden />
          </button>
        </div>
        )}
        <a
          href={current.downloadUrl}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-sm font-medium hover:bg-white/20"
          download
        >
          <Download className="h-4 w-4" strokeWidth={1.7} />
          {t('common.download')}
        </a>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/20"
          aria-label={t('common.close', { defaultValue: 'Close' })}
        >
          <X className="h-5 w-5" strokeWidth={1.8} />
        </button>
      </div>

      {/* Stage */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {count > 1 && (
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={index === 0}
            aria-label={t('common.previous', { defaultValue: 'Previous' })}
            className="absolute start-0 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30"
          >
            <ChevronLeft className="h-6 w-6 rtl:rotate-180" strokeWidth={1.8} />
          </button>
        )}

        {current.kind === 'image' && current.imageUrl && !imgError ? (
          <div
            data-testid="viewer-stage"
            style={{ transform: `rotate(${rotation}deg) scale(${zoom})`, transformOrigin: 'center center' }}
            className="flex items-center justify-center"
          >
            <img
              src={current.imageUrl}
              alt={current.name}
              onError={() => setImgError(true)}
              className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl"
            />
          </div>
        ) : current.kind === 'pdf' && current.pdfBase64Url ? (
          <div
            data-testid="viewer-stage"
            style={{ transform: `rotate(${rotation}deg) scale(${zoom})`, transformOrigin: 'center center' }}
            className="h-full w-full max-w-5xl"
          >
            <Suspense fallback={<ViewerSpinner />}>
              <PdfViewer base64Url={current.pdfBase64Url} />
            </Suspense>
          </div>
        ) : (
          downloadFallback
        )}

        {count > 1 && (
          <button
            type="button"
            onClick={() => go(1)}
            disabled={index === count - 1}
            aria-label={t('common.next', { defaultValue: 'Next' })}
            className="absolute end-0 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30"
          >
            <ChevronRight className="h-6 w-6 rtl:rotate-180" strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}
