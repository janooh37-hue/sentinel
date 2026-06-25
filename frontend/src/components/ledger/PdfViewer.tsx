/**
 * PdfViewer — renders a PDF attachment with pdf.js (canvas), not an <iframe>.
 *
 * The iframe approach downloaded/blanked in the packaged WebView; rendering to
 * canvas is deterministic. Lazy-loaded (default export) so pdf.js + its worker
 * only ship in the preview chunk. Fetches the inline attachment URL as bytes.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Loader2 } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

export default function PdfViewer({
  base64Url,
}: {
  base64Url: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    const container = containerRef.current

    void (async () => {
      try {
        // Fetch base64 (text/plain) so the browser never sees a %PDF body to
        // claim for its PDF stream handler; pdf.js renders the decoded bytes.
        const res = await fetch(base64Url, { credentials: 'same-origin' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = base64ToBytes(await res.text())
        if (cancelled) return
        // `disableFontFace` makes pdf.js draw glyph outlines directly instead
        // of loading the embedded fonts via the browser's FontFace API. Brave's
        // fingerprinting protection blocks/alters FontFace, which made pdf.js
        // fall back to system fonts with wrong metrics → broken letter spacing.
        // Path rendering is browser-independent (correct in Brave + WebView).
        const doc = await pdfjsLib.getDocument({
          data,
          disableFontFace: true,
        }).promise
        if (cancelled || !container) return
        container.replaceChildren()
        // Render at device pixel ratio so text stays sharp on HiDPI / Windows-
        // scaled displays. The bitmap is logical×dpr device pixels; CSS width is
        // the logical size and height is `auto` (h-auto) so `max-w-full` can
        // shrink it on narrow viewports without distorting the aspect ratio.
        const dpr = window.devicePixelRatio || 1
        for (let n = 1; n <= doc.numPages; n += 1) {
          if (cancelled) return
          const page = await doc.getPage(n)
          const viewport = page.getViewport({ scale: 2 })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width * dpr)
          canvas.height = Math.floor(viewport.height * dpr)
          canvas.style.width = `${Math.floor(viewport.width)}px`
          canvas.className = 'mb-3 h-auto max-w-full rounded-lg bg-white shadow-lg'
          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          container.appendChild(canvas)
          await page.render({
            canvas,
            canvasContext: ctx,
            viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          }).promise
        }
        if (!cancelled) setStatus('ready')
      } catch (err) {
        console.error('PdfViewer render failed:', err)
        if (!cancelled) setStatus('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [base64Url])

  return (
    <div className="flex h-full w-full flex-col items-center overflow-auto py-2">
      {status === 'loading' && (
        <div className="flex flex-1 items-center justify-center text-white/70">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}
      {status === 'error' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-white/70">
          <AlertCircle className="h-6 w-6" />
          <span className="text-sm">
            {t('ledger.attachments.renderFailed', {
              defaultValue: "Couldn't render this file",
            })}
          </span>
        </div>
      )}
      <div ref={containerRef} className="flex flex-col items-center" />
    </div>
  )
}
