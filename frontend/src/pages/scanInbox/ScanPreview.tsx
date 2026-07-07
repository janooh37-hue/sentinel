/**
 * ScanPreview — a readable A4-portrait preview of one scanned document, shared
 * by the triage card and the match dialog.
 *
 * Images render via <img>; PDFs via a lazy single-page pdf.js canvas
 * (WebView2-safe). Clicking the frame opens the full-screen DocumentViewerDialog
 * (zoom/rotate/pan) for fine reading. On render failure it shows a clean
 * "open document" fallback rather than a blank frame.
 */

import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Maximize2 } from 'lucide-react'

import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toBase64Url } from '@/lib/pdf'
import { fileKindFromName } from '@/lib/fileTypes'
import { DocumentViewerDialog, type DocViewerItem } from '@/components/ui/document-viewer-dialog'
import { isPdf } from './scanFileType'

const ScanPdfCanvas = lazy(() => import('./ScanPdfCanvas'))

export function ScanPreview({
  itemId,
  filename,
  variant,
}: {
  itemId: number
  filename: string
  variant: 'card' | 'dialog'
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const url = api.scanDocumentUrl(itemId)
  const pdf = isPdf(filename)

  const viewerItem: DocViewerItem = {
    name: filename,
    kind: fileKindFromName(filename),
    imageUrl: pdf ? undefined : url,
    pdfBase64Url: pdf ? toBase64Url(url) : undefined,
    openUrl: url,
    downloadUrl: url,
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('scanInbox.openZoom')}
        className={cn(
          'group relative block w-full overflow-hidden rounded-md border border-border bg-white',
          'aspect-[210/297]',
          variant === 'card' ? 'sm:max-w-[240px]' : 'max-w-[300px]',
        )}
      >
        {failed ? (
          <span className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-tinted text-muted-foreground">
            <FileText className="h-7 w-7" aria-hidden />
            <span className="text-[0.72em]">{t('scanInbox.openFullDoc')}</span>
          </span>
        ) : pdf ? (
          <Suspense fallback={<span className="block h-full w-full animate-pulse bg-surface-tinted" />}>
            <ScanPdfCanvas pdfUrl={url} onError={() => setFailed(true)} />
          </Suspense>
        ) : (
          <img
            src={url}
            alt={filename}
            className="h-full w-full object-contain"
            onError={() => setFailed(true)}
          />
        )}
        <span className="pointer-events-none absolute bottom-1.5 end-1.5 rounded bg-black/55 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Maximize2 className="h-3.5 w-3.5" aria-hidden />
        </span>
      </button>
      {open && <DocumentViewerDialog items={[viewerItem]} onClose={() => setOpen(false)} />}
    </>
  )
}
