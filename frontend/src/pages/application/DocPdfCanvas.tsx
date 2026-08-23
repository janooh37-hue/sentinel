/**
 * DocPdfCanvas — renders a generated document's PDF with pdf.js (canvas),
 * not an <iframe>.
 *
 * The iframe approach (`<iframe src=pdfUrl>`) downloaded/blanked in the
 * packaged Edge WebView2, so this preview fetches inline PDF bytes and paints
 * each page to a canvas. Lazy-loaded (default export) so pdf.js + its worker
 * only ship in the preview chunk.
 *
 * **IDM bypass:** fetches the bytes as ``?encoding=base64`` (text/plain) so
 * Internet Download Manager (and Chrome's PDF stream handler) can't sniff the
 * URL/body, claim it, and return an empty 204 to the JS fetch.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Download, Loader2 } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import { base64ToBytes, toBase64Url } from '@/lib/pdf'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

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

function DocPdfCanvasRenderer({
  pdfUrl,
  pdfBase64,
  docxUrl,
  renderOverlay,
  onReady,
}: DocPdfCanvasProps): React.JSX.Element {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const onReadyRef = useRef(onReady)
  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  // 'missing' = the PDF was never generated (backend 404 / PDF_NOT_AVAILABLE);
  // 'render' = the bytes came back but pdf.js (or the worker asset) couldn't
  // paint them. Distinct messages so operators can tell "no PDF was produced"
  // from "the PDF is broken".
  const [errorKind, setErrorKind] = useState<'missing' | 'render'>('render')
  const [pages, setPages] = useState<PageBox[]>([])

  const measure = useCallback((): void => {
    const wrap = wrapperRef.current
    const cont = containerRef.current
    if (!wrap || !cont) return
    const wr = wrap.getBoundingClientRect()
    const boxes: PageBox[] = Array.from(cont.querySelectorAll('canvas')).map((cv, i) => {
      const r = cv.getBoundingClientRect()
      return { page: i + 1, left: r.left - wr.left, top: r.top - wr.top, width: r.width, height: r.height }
    })
    setPages(boxes)
  }, [])

  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    // Abort the in-flight fetch on unmount/remount — the live word-session
    // preview remounts this component per Word save while the server-side
    // conversion can still be running for seconds.
    const controller = new AbortController()

    void (async () => {
      try {
        let data: Uint8Array
        if (pdfBase64 !== undefined) {
          data = base64ToBytes(pdfBase64)
        } else {
          // Fetch base64 (text/plain) so neither IDM nor Chrome's built-in PDF
          // viewer can sniff the response and intercept it (returning empty 204).
          const res = await fetch(toBase64Url(pdfUrl), {
            credentials: 'same-origin',
            signal: controller.signal,
          })
          if (!res.ok) {
            // 404 means the backend has no PDF on disk for this document.
            if (!cancelled) setErrorKind(res.status === 404 ? 'missing' : 'render')
            throw new Error(`HTTP ${res.status}`)
          }
          data = base64ToBytes(await res.text())
        }
        if (cancelled) return
        // `disableFontFace`: draw glyph outlines directly rather than via the
        // browser FontFace API — deterministic across Brave fingerprint
        // protection + the packaged WebView (see PdfViewer.tsx for the full
        // rationale).
        const doc = await pdfjsLib.getDocument({ data, disableFontFace: true }).promise
        if (cancelled || !container) return
        container.replaceChildren()
        const dpr = window.devicePixelRatio || 1
        for (let n = 1; n <= doc.numPages; n += 1) {
          if (cancelled) return
          const page = await doc.getPage(n)
          const viewport = page.getViewport({ scale: 1.5 })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width * dpr)
          canvas.height = Math.floor(viewport.height * dpr)
          canvas.style.width = `${Math.floor(viewport.width)}px`
          canvas.className = 'mb-3 h-auto max-w-full rounded-lg bg-white shadow-lg'
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('Canvas 2D context unavailable')
          container.appendChild(canvas)
          await page.render({
            canvas,
            canvasContext: ctx,
            viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          }).promise
        }
        if (!cancelled) {
          setStatus('ready')
          measure()
        }
      } catch (err) {
        if (!cancelled) {
          console.error('DocPdfCanvas render failed:', err)
          setStatus('error')
        }
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [pdfUrl, pdfBase64, measure])

  useEffect(() => {
    if (status === 'ready') onReadyRef.current?.()
  }, [status])

  // Keep page boxes in sync as the responsive canvases reflow (only when an
  // overlay consumer is attached).
  useEffect(() => {
    if (!renderOverlay) return
    const wrap = wrapperRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [renderOverlay, measure])

  return (
    <div className="flex h-full min-h-[400px] w-full flex-col items-center overflow-auto rounded-md border border-border bg-muted/30 py-3">
      {status === 'loading' && (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}
      {status === 'error' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <AlertCircle className="h-6 w-6" />
          <span className="text-sm">
            {errorKind === 'missing'
              ? t('application.pdfNotGenerated', {
                  defaultValue:
                    "No PDF was generated for this document — download the DOCX instead.",
                })
              : t('ledger.attachments.renderFailed', {
                  defaultValue: "Couldn't render this file",
                })}
          </span>
          {docxUrl && (
            <a
              href={docxUrl}
              download
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('application.downloadDocx')}
            </a>
          )}
        </div>
      )}
      <div ref={wrapperRef} className="relative flex flex-col items-center">
        <div ref={containerRef} className="flex flex-col items-center" />
        {renderOverlay && pages.length > 0 && renderOverlay(pages)}
      </div>
    </div>
  )
}
