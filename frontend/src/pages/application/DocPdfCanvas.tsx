/**
 * DocPdfCanvas — renders a generated document's PDF with pdf.js (canvas),
 * not an <iframe>.
 *
 * The iframe approach (`<iframe src=pdfUrl>`) downloaded/blanked in the
 * packaged Edge WebView2 — the same failure the ledger team hit and solved
 * with a canvas renderer (`components/ledger/PdfViewer.tsx`). This mirrors that
 * pattern for the document-generation preview: fetch the inline PDF bytes and
 * paint each page to a canvas. Lazy-loaded (default export) so pdf.js + its
 * worker only ship in the preview chunk.
 *
 * **IDM bypass:** fetches the bytes as ``?encoding=base64`` (text/plain) so
 * Internet Download Manager (and Chrome's PDF stream handler) can't sniff the
 * URL/body, claim it, and return an empty 204 to the JS fetch. pdf.js decodes
 * the base64 into a Uint8Array and renders it. Same trick the ledger team
 * uses for attachment previews — see `components/ledger/PdfViewer.tsx`.
 *
 * The parsed document comes from `lib/pdfDocCache` (same proxy for the same
 * URL, destroyed on eviction / unmount); pages are lazy, aspect-correct
 * placeholders painted by `PdfPages`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useTranslation } from 'react-i18next'

import { PdfPages } from '@/components/books/PdfPages'
import { DocumentState } from '@/components/books/DocumentState'
import { documentErrorKind } from '@/components/books/documentState'
import { leasePdfBase64, leasePdfUrl, PdfFetchError, type PdfDocLease } from '@/lib/pdfDocCache'
import { cn } from '@/lib/utils'

export interface PageBox {
  page: number
  left: number
  top: number
  width: number
  height: number
}

interface DocPdfCanvasCommonProps {
  /**
   * Optional DOCX download URL. When the PDF fails to render (e.g. the pdf.js
   * worker asset 404s in the packaged build), the error state offers this as a
   * download so the operator isn't dead-ended.
   */
  docxUrl?: string
  /**
   * Optional overlay slot. Receives the rendered page boxes (CSS px, relative to
   * the scroll content).
   */
  renderOverlay?: (pages: PageBox[]) => React.ReactNode
  /** Called once after all PDF pages have finished painting. */
  onReady?: () => void
  /**
   * `natural` (default): each page at its 1.5× size, capped to the container.
   * `fit`: pages fill the container width — the host sets the width, so a zoom
   * is just a wider host (CSS scale first, then a debounced re-raster).
   */
  sizing?: 'natural' | 'fit'
  /** No frame / own scroll box: the host owns scrolling and chrome (the desk). */
  bare?: boolean
  /** The page nearest the top of the viewport changed (feeds the page counter). */
  onPageChange?: (page: number, total: number) => void
}

type DocPdfCanvasProps = DocPdfCanvasCommonProps &
  (
    | {
        /** Inline PDF download URL, e.g. `/api/v1/documents/{id}/download?format=pdf`. */
        pdfUrl: string
        pdfBase64?: never
        sourceKey?: never
      }
    | {
        /** Already-loaded base64 PDF, such as an included-papers preview response. */
        pdfBase64: string
        /** Small identity that changes whenever the supplied PDF bytes change. */
        sourceKey: string
        pdfUrl?: never
      }
  )

export default function DocPdfCanvas(props: DocPdfCanvasProps): React.JSX.Element {
  return <DocPdfCanvasRenderer key={props.pdfUrl ?? props.sourceKey} {...props} />
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; doc: PDFDocumentProxy; painted: boolean }
  | { kind: 'error'; error: unknown }

function DocPdfCanvasRenderer({
  pdfUrl,
  pdfBase64,
  sourceKey,
  docxUrl,
  renderOverlay,
  onReady,
  sizing = 'natural',
  bare = false,
  onPageChange,
}: DocPdfCanvasProps): React.JSX.Element {
  const { t } = useTranslation()
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const onReadyRef = useRef(onReady)
  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  // Retry bumps this: a failed load is never cached, so the effect refetches.
  const [nonce, setNonce] = useState(0)
  const [pages, setPages] = useState<PageBox[]>([])

  const measure = useCallback((): void => {
    const wrap = wrapperRef.current
    if (!wrap) return
    const wr = wrap.getBoundingClientRect()
    setPages(
      Array.from(wrap.querySelectorAll<HTMLElement>('[data-pdf-page]')).map((box, i) => {
        const r = box.getBoundingClientRect()
        return { page: i + 1, left: r.left - wr.left, top: r.top - wr.top, width: r.width, height: r.height }
      }),
    )
  }, [])

  const source = pdfUrl ?? sourceKey ?? ''
  useEffect(() => {
    // Abort the in-flight fetch on unmount/remount — the live word-session
    // preview remounts this component per Word save while the server-side
    // conversion can still be running for seconds.
    const controller = new AbortController()
    let lease: PdfDocLease | null = null
    const request =
      pdfBase64 !== undefined
        ? leasePdfBase64(source, pdfBase64, controller.signal)
        : leasePdfUrl(source, controller.signal)
    request.then(
      (l) => {
        lease = l
        setState({ kind: 'loaded', doc: l.doc, painted: false })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        console.error('DocPdfCanvas render failed:', error)
        setState({ kind: 'error', error })
      },
    )
    return () => {
      controller.abort()
      lease?.release()
    }
    // `source` identifies the bytes; pdfBase64 is the payload for that identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, nonce])

  const painted = state.kind === 'loaded' && state.painted
  useEffect(() => {
    if (painted) onReadyRef.current?.()
  }, [painted])

  // Keep page boxes in sync as the responsive boxes reflow (only when an
  // overlay consumer is attached).
  useEffect(() => {
    if (!renderOverlay) return
    const wrap = wrapperRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [renderOverlay, measure])

  const retry = (): void => {
    setState({ kind: 'loading' })
    setNonce((n) => n + 1)
  }

  const frame = cn(
    'flex w-full flex-col items-center',
    bare ? '' : 'h-full min-h-[400px] overflow-auto rounded-md border border-border bg-muted/30 py-3',
  )

  if (state.kind === 'error') {
    const missing = state.error instanceof PdfFetchError && state.error.status === 404
    const errorKind = documentErrorKind(state.error)
    return (
      <div className={cn(frame, 'justify-center')}>
        <DocumentState
          kind={errorKind}
          onRetry={errorKind === 'error' ? retry : undefined}
          openUrl={pdfUrl}
          docxUrl={docxUrl}
          title={
            missing
              ? docxUrl
                ? t('application.pdfNotGenerated')
                : t('application.pdfUnavailableNoDocx')
              : undefined
          }
          body={missing ? '' : undefined}
        />
      </div>
    )
  }

  return (
    <div className={frame}>
      {state.kind === 'loading' ? (
        <DocumentState kind="loading" />
      ) : (
        <div ref={wrapperRef} className="relative w-full">
          <PdfPages
            doc={state.doc}
            sizing={{ kind: sizing === 'fit' ? 'fit' : 'natural' }}
            pageClassName="rounded-lg shadow-lg"
            onLayout={renderOverlay ? measure : undefined}
            onCurrentPage={onPageChange}
            onPainted={() => setState((s) => (s.kind === 'loaded' && !s.painted ? { ...s, painted: true } : s))}
            onError={(error) => {
              console.error('DocPdfCanvas render failed:', error)
              setState({ kind: 'error', error })
            }}
          />
          {renderOverlay && pages.length > 0 && renderOverlay(pages)}
        </div>
      )}
    </div>
  )
}
