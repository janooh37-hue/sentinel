/**
 * DocPreview — shows an in-app PDF preview when available, otherwise a
 * deliberate "PDF unavailable" state with a DOCX download.
 *
 * When multiple documents are present (primary + companion), a "1 of N" pill
 * lets the operator cycle between them. Download buttons always reflect the
 * currently-previewed document.
 *
 * Rendering uses a pdf.js **canvas** (`DocPdfCanvas`), not an `<iframe>`: the
 * iframe approach blanked/downloaded inside the packaged Edge WebView2 — the
 * same failure the ledger team documented (`PdfViewer.tsx`). The canvas
 * renderer is lazy so pdf.js only loads when a preview is shown. Download is a
 * secondary action; the preview anchor never carries `download`.
 */

import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, ChevronLeft, ChevronRight, Loader2, Download } from 'lucide-react'

import type { JobDocumentItem } from '@/lib/api'

const DocPdfCanvas = lazy(() => import('./DocPdfCanvas'))

interface DocPreviewProps {
  documents: JobDocumentItem[]
}

export function DocPreview({ documents }: DocPreviewProps): React.JSX.Element {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)

  if (documents.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <FileText className="h-10 w-10 text-muted-foreground/40" strokeWidth={1.2} />
        <p className="text-sm font-medium text-foreground">{t('application.noDocuments')}</p>
      </div>
    )
  }

  const doc = documents[Math.min(index, documents.length - 1)]
  const isMulti = documents.length > 1

  function prev(): void {
    setIndex((i) => Math.max(0, i - 1))
  }

  function next(): void {
    setIndex((i) => Math.min(documents.length - 1, i + 1))
  }

  const pdfUrl = doc.pdf_url ?? null
  const docxUrl = doc.docx_url

  return (
    <div className="flex h-full flex-col">
      {/* Header row: ref + doc info + optional pill */}
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">{doc.ref_number}</span>
        <span className="text-border">·</span>
        <span>doc #{doc.document_id}</span>
        {doc.role === 'companion' && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            companion
          </span>
        )}

        {/* Multi-doc pill — cycles between primary and companion(s) */}
        {isMulti && (
          <span className="ms-auto flex items-center gap-0.5">
            <button
              onClick={prev}
              disabled={index === 0}
              aria-label={t('application.prevDoc')}
              className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
            >
              <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" />
            </button>
            <span className="select-none px-1 font-mono text-xs">
              {index + 1} / {documents.length}
            </span>
            <button
              onClick={next}
              disabled={index === documents.length - 1}
              aria-label={t('application.nextDoc')}
              className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
            >
              <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
            </button>
          </span>
        )}
      </div>

      {/* PDF preview (pdf.js canvas) or a deliberate unavailable state */}
      {pdfUrl ? (
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center rounded-md border border-border bg-muted/30">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }
        >
          {/* key on the URL so cycling docs remounts the renderer cleanly */}
          <DocPdfCanvas key={pdfUrl} pdfUrl={pdfUrl} />
        </Suspense>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/40" strokeWidth={1.2} />
          <div className="max-w-xs">
            <p className="text-sm font-medium text-foreground">{t('application.pdfUnavailable')}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{doc.ref_number}</p>
          </div>
          <a
            href={docxUrl}
            download
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('application.downloadDocx')}
          </a>
        </div>
      )}

      {/* Secondary download actions (always available when a preview is shown) */}
      {pdfUrl && (
        <div className="mt-2 flex gap-2">
          <a
            href={pdfUrl}
            download
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <Download className="h-3 w-3" strokeWidth={1.8} />
            {t('application.downloadPdf')}
          </a>
          <a
            href={docxUrl}
            download
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <Download className="h-3 w-3" strokeWidth={1.8} />
            {t('application.downloadDocx')}
          </a>
        </div>
      )}
    </div>
  )
}
