/**
 * Page-1 thumbnail of the record's own paper, for every scan-back row.
 *
 * A ref number and a subject don't tell an operator which of the sheets on
 * their desk this row is — the paper does. Reuses `scanInbox/ScanPdfCanvas`
 * (page-1 pdf.js canvas, WebView2/IDM-safe) rather than adding a second PDF
 * renderer; falls back to a plain icon tile when the record has no generated
 * document or the PDF won't render (DOCX->PDF can leave `pdf_path` NULL).
 *
 * Decorative: the row already names the record in text, so the tile is
 * `aria-hidden` and needs no string of its own.
 *
 * Mounting is gated on visibility — the page can list 20+ stranded records and
 * every thumb is its own PDF fetch plus a pdf.js document.
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { FileText } from 'lucide-react'

import { api, type BookRead } from '@/lib/api'
import { currentBookDocId } from '@/lib/bookDocument'
import { cn } from '@/lib/utils'

const ScanPdfCanvas = lazy(() => import('@/pages/scanInbox/ScanPdfCanvas'))

export function ScanBackThumb({
  book,
  className,
}: {
  book: BookRead
  /** Width utility, e.g. `w-20`. Height follows from the A4 aspect ratio. */
  className?: string
}): React.JSX.Element {
  const docId = currentBookDocId(book)
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el || visible) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  return (
    <div
      ref={boxRef}
      aria-hidden
      className={cn(
        'aspect-[210/297] shrink-0 overflow-hidden rounded-md border border-hairline bg-white',
        className,
      )}
    >
      {docId != null && visible && !failed ? (
        <Suspense fallback={<span className="block h-full w-full animate-pulse bg-surface-tinted" />}>
          <ScanPdfCanvas
            pdfUrl={api.documentDownloadUrl(docId, 'pdf')}
            onError={() => setFailed(true)}
          />
        </Suspense>
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-surface-tinted text-faint">
          <FileText className="h-4 w-4" strokeWidth={1.8} />
        </span>
      )}
    </div>
  )
}
