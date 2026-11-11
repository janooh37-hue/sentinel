/**
 * LedgerPaperCanvas — the pdf.js page stack for a Ledger paper preview.
 *
 * Unlike the document viewer's `DocPdfCanvas` (which remounts per URL), a new
 * `url` swaps the document in place: the previous pages stay on screen, and the
 * host's scroll position and zoom survive, until the new document arrives. The
 * composer passes a fresh cache-busting URL after every autosave, so a remount
 * there would throw the reader back to the top each time. Lazy-loaded (default
 * export) so pdf.js ships only in the preview chunk.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { leasePdfUrl, PdfFetchError, type PdfDocLease } from '@/lib/pdfDocCache'
import { DocumentState } from './DocumentState'
import { documentErrorKind } from './documentError'
import { PdfPages } from './PdfPages'

export default function LedgerPaperCanvas({ url, onPageChange }: {
  url: string
  onPageChange?: (page: number, total: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [current, setCurrent] = useState<PdfDocLease | null>(null)
  const [error, setError] = useState<unknown>(null)
  // A failed load is never cached, so bumping this refetches.
  const [nonce, setNonce] = useState(0)
  // The lease of the document on screen. It is released only once its replacement
  // has arrived (or on unmount), so the cache cannot evict pages still being shown.
  const shown = useRef<PdfDocLease | null>(null)

  useEffect(() => () => {
    shown.current?.release()
    shown.current = null
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    leasePdfUrl(url, controller.signal).then(
      (lease) => {
        if (controller.signal.aborted) {
          lease.release()
          return
        }
        shown.current?.release()
        shown.current = lease
        setCurrent(lease)
        setError(null)
      },
      (failure: unknown) => {
        if (controller.signal.aborted) return
        console.error('LedgerPaperCanvas render failed:', failure)
        setError(failure)
      },
    )
    return () => controller.abort()
  }, [url, nonce])

  if (error !== null) {
    const missing = error instanceof PdfFetchError && error.status === 404
    const kind = documentErrorKind(error)
    return (
      <div className="flex w-full flex-col items-center justify-center">
        <DocumentState
          kind={kind}
          onRetry={kind === 'error' ? () => { setError(null); setNonce((n) => n + 1) } : undefined}
          openUrl={url}
          title={missing ? t('application.pdfUnavailableNoDocx') : undefined}
          body={missing ? '' : undefined}
        />
      </div>
    )
  }
  if (!current) return <DocumentState kind="loading" />
  return (
    <div data-pdf-canvas className="relative w-full">
      <PdfPages
        doc={current.doc}
        sizing={{ kind: 'fit' }}
        pageClassName="rounded-lg shadow-lg"
        onCurrentPage={onPageChange}
        onError={(failure) => {
          console.error('LedgerPaperCanvas render failed:', failure)
          setError(failure)
        }}
      />
    </div>
  )
}
