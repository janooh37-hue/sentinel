/**
 * ScanPdfCanvas — renders page 1 of a scanned PDF with pdf.js (canvas).
 *
 * `<object>/<iframe>` PDF embedding blanks/downloads inside the packaged Edge
 * WebView2 (see application/DocPdfCanvas.tsx, ledger/PdfViewer.tsx). This paints
 * the first page to a canvas instead. Only page 1 — enough to recognise the doc
 * and read its header during triage; full reading is one click away in
 * DocumentViewerDialog. Lazy default export so pdf.js only ships when a preview
 * shows. Fetches `?encoding=base64` (text/plain) so the WebView2/IDM PDF handler
 * can't hijack the response.
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import { base64ToBytes, toBase64Url } from '@/lib/pdf'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export default function ScanPdfCanvas({
  pdfUrl,
  onError,
}: {
  pdfUrl: string
  onError?: () => void
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [loading, setLoading] = useState(true)
  const onErrorRef = useRef(onError)
  useEffect(() => { onErrorRef.current = onError }, [onError])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(toBase64Url(pdfUrl), { credentials: 'same-origin' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = base64ToBytes(await res.text())
        if (cancelled) return
        const doc = await pdfjsLib.getDocument({ data, disableFontFace: true }).promise
        const page = await doc.getPage(1)
        const canvas = canvasRef.current
        if (cancelled || !canvas) return
        const dpr = window.devicePixelRatio || 1
        const cssWidth = canvas.parentElement?.clientWidth || 240
        const base = page.getViewport({ scale: 1 })
        const scale = cssWidth / base.width
        const viewport = page.getViewport({ scale })
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = 'auto'
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no 2d context')
        await page.render({
          canvas,
          canvasContext: ctx,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        }).promise
        if (!cancelled) setLoading(false)
      } catch (err) {
        console.error('ScanPdfCanvas render failed:', err)
        if (!cancelled) onErrorRef.current?.()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pdfUrl])

  return (
    <div className="relative flex h-full w-full items-start justify-center">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
      <canvas ref={canvasRef} className="block w-full" />
    </div>
  )
}
