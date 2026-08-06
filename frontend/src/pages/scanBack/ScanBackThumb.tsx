/**
 * Page-1 thumbnail of the record's own paper, for every scan-back row — and
 * the way into a full-screen read of it.
 *
 * A ref number and a subject don't tell an operator which of the sheets on
 * their desk this row is, and a 128px crop only narrows it down: click the tile
 * and the whole form opens in `DocumentViewerDialog` (zoom, rotate, download —
 * the same lightbox the scan inbox uses), so identification never depends on
 * squinting at the thumbnail.
 *
 * Reuses `scanInbox/ScanPdfCanvas` (page-1 pdf.js canvas, WebView2/IDM-safe)
 * rather than adding a second PDF renderer; falls back to a plain icon tile
 * when the record has no generated document or the PDF won't render (DOCX->PDF
 * can leave `pdf_path` NULL). That tile stays decorative and unclickable —
 * there is nothing to open.
 *
 * Mounting is gated on visibility — the page can list 20+ stranded records and
 * every thumb is its own PDF fetch plus a pdf.js document.
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Maximize2 } from 'lucide-react'

import { api, type BookRead } from '@/lib/api'
import { currentBookDocId } from '@/lib/bookDocument'
import { toBase64Url } from '@/lib/pdf'
import { cn } from '@/lib/utils'
import { DocumentViewerDialog, type DocViewerItem } from '@/components/ui/document-viewer-dialog'

const ScanPdfCanvas = lazy(() => import('@/pages/scanInbox/ScanPdfCanvas'))

// The TOP of the sheet, not the whole A4: a government form carries its
// identity in the first third (letterhead, title, date, ref, name) and the rest
// is body text no thumbnail can render legibly. Cropping there keeps rows ~90px
// instead of ~180px, which matters at 20+ rows and on a short viewport.
// ScanPdfCanvas top-anchors its canvas, so the overflow simply clips the
// bottom of the page — the full sheet is one click away in the viewer.
const FRAME = 'aspect-[16/11] shrink-0 overflow-hidden rounded-md border border-hairline bg-white'

export function ScanBackThumb({
  book,
  className,
}: {
  book: BookRead
  /** Width utility, e.g. `w-32`. Height follows from the crop's aspect ratio. */
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const docId = currentBookDocId(book)
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  // Typed as HTMLElement, not HTMLDivElement: the frame is a <button> when
  // there's a document to open and a plain <div> when there isn't.
  const boxRef = useRef<HTMLElement | null>(null)
  const setBox = (el: HTMLElement | null): void => {
    boxRef.current = el
  }

  useEffect(() => {
    const el = boxRef.current
    if (!el || visible) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  const pdfUrl = docId != null ? api.documentDownloadUrl(docId, 'pdf') : null

  const inner =
    pdfUrl !== null && visible && !failed ? (
      <Suspense fallback={<span className="block h-full w-full animate-pulse bg-surface-tinted" />}>
        <ScanPdfCanvas pdfUrl={pdfUrl} onError={() => setFailed(true)} />
      </Suspense>
    ) : (
      <span
        data-testid="thumb-fallback"
        className="flex h-full w-full items-center justify-center bg-surface-tinted text-faint"
      >
        <FileText className="h-4 w-4" strokeWidth={1.8} />
      </span>
    )

  // Nothing to open: the tile is pure decoration, and the row already names the
  // record in text, so it stays out of the accessibility tree.
  if (pdfUrl === null) {
    return <div ref={setBox} aria-hidden className={cn(FRAME, className)}>{inner}</div>
  }

  const ref = book.ref_number ?? `#${book.id}`
  const item: DocViewerItem = {
    name: book.subject ? `${ref} — ${book.subject}` : ref,
    kind: 'pdf',
    // base64 so neither IDM nor Chrome's PDF handler can hijack the response —
    // see lib/pdf.ts.
    pdfBase64Url: toBase64Url(pdfUrl),
    openUrl: pdfUrl,
    downloadUrl: pdfUrl,
  }

  return (
    <>
      <button
        type="button"
        ref={setBox}
        onClick={() => setZoomed(true)}
        // Deliberately borrowed from the scan inbox rather than duplicated: the
        // string is generic ("Open document — zoom & rotate") and already has
        // its Arabic, so this adds no new EN/AR parity surface.
        aria-label={t('scanInbox.openZoom')}
        className={cn(
          'group relative block transition-colors hover:border-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          FRAME,
          className,
        )}
      >
        {inner}
        <span className="pointer-events-none absolute bottom-1 end-1 rounded bg-black/55 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Maximize2 className="h-3 w-3" aria-hidden />
        </span>
      </button>
      {zoomed && <DocumentViewerDialog items={[item]} onClose={() => setZoomed(false)} />}
    </>
  )
}
