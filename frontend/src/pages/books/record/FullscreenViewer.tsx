/**
 * FullscreenViewer — the phone paper viewer (the desk's Expand corner / `F`).
 * `role=dialog aria-modal`, opened and closed through `useRecordChrome().fullscreen`.
 * It shows the same paper list as the desk (`RecordDesk` passes it down), so an
 * inmate reporter never sees a scan or an `original=true` paper here either.
 *
 * Esc is handled here: the global shortcut layer stands down while an
 * `aria-modal` element is open (like any dialog).
 */

import { lazy, Suspense, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Minus, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { DocumentState } from '@/components/books/DocumentState'
import { useFocusTrap } from '@/lib/useFocusTrap'
import { cn } from '@/lib/utils'

import { paperKey, type Paper, type PaperKey } from '../recordPapers'
import { PaperSwitcher } from './DeskToolbar'

const DocPdfCanvas = lazy(() => import('@/pages/application/DocPdfCanvas'))

const MIN_ZOOM = 1
const MAX_ZOOM = 3
const ZOOM_STEP = 0.5

export function FullscreenViewer({
  papers,
  labels,
  selectedKey,
  onSelect,
  onClose,
  docxUrl,
}: {
  papers: readonly Paper[]
  labels: readonly string[]
  selectedKey: PaperKey | null
  onSelect: (key: PaperKey) => void
  onClose: () => void
  docxUrl?: string
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const trapRef = useFocusTrap<HTMLDivElement>(true, '[data-fsv-close]')
  // 1 = fit to the screen width; the page scrolls in both axes beyond that.
  const [zoom, setZoom] = useState(1)
  const [page, setPage] = useState<{ page: number; total: number } | null>(null)

  const paper = papers.find((p) => paperKey(p) === selectedKey) ?? papers[0]

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const barBtn =
    'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border border-[#2e3442] bg-[#1f2533] px-3 text-[0.85em] font-semibold text-[#e6e9f2] transition-colors hover:bg-[#2a3142] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 motion-reduce:transition-none'

  return createPortal(
    <div
      ref={trapRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('books.pane.fullPreview')}
      dir={i18n.dir()}
      data-print-hide
      tabIndex={-1}
      className="fixed inset-0 z-[80] flex flex-col bg-[#0f131b] text-[#e6e9f2] focus-visible:outline-none"
    >
      <div className="flex flex-none items-center gap-2 px-3 py-2.5">
        <button type="button" data-fsv-close aria-label={t('common.close')} onClick={onClose} className={barBtn}>
          <X className="h-5 w-5" aria-hidden />
        </button>
        {papers.length > 1 ? (
          <div className="min-w-0 flex-1">
            <PaperSwitcher
              papers={papers}
              labels={labels}
              selectedKey={paper ? paperKey(paper) : null}
              onSelect={onSelect}
              variant="chips"
              dark
            />
          </div>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[0.85em] font-semibold">
            {paper ? labels[papers.indexOf(paper)] : null}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2.5">
        {paper ? (
          <div className="mx-auto shrink-0" style={{ width: `${zoom * 100}%` }}>
            {paper.isPdf ? (
              <Suspense fallback={<DocumentState kind="loading" />}>
                <DocPdfCanvas
                  key={paper.url}
                  pdfUrl={paper.url}
                  docxUrl={paper.kind === 'generated' ? docxUrl : undefined}
                  sizing="fit"
                  bare
                  onPageChange={(p, total) => setPage({ page: p, total })}
                />
              </Suspense>
            ) : (
              <img src={paper.url} alt={paper.filename} draggable={false} className="block w-full rounded bg-white" />
            )}
          </div>
        ) : null}
      </div>

      <div className="flex flex-none items-center gap-2 px-3 pb-[max(0.625rem,var(--safe-bottom))] pt-2.5">
        <span className={cn('min-w-0 flex-1 font-mono text-[0.8em] font-semibold text-[#cfd3dc]')}>
          {paper?.isPdf && page && page.total > 0 ? (
            <>
              <span className="sr-only">{t('books.paper.pageOf', { i: page.page, n: page.total })}</span>
              <bdi dir="ltr" aria-hidden className="tabular-nums">
                {page.page} / {page.total}
              </bdi>
            </>
          ) : null}
        </span>
        {paper?.isPdf ? (
          <>
            <button
              type="button"
              aria-label={t('books.pane.zoomOut')}
              disabled={zoom <= MIN_ZOOM}
              onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
              className={barBtn}
            >
              <Minus className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={t('books.pane.zoomIn')}
              disabled={zoom >= MAX_ZOOM}
              onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
              className={barBtn}
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </>
        ) : null}
        {paper ? (
          <a href={paper.downloadUrl} download={paper.filename} className={barBtn}>
            <Download className="h-4 w-4" aria-hidden />
            {t('books.paper.download')}
          </a>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
