/**
 * PdfPages — the shared page stack for every pdf.js canvas viewer on the record
 * surfaces (the desk's `DocPdfCanvas`, the pane's `PaperCanvas`).
 *
 *  - Every page is an aspect-correct placeholder box from the first frame, so
 *    the layout, the page counter and the annotation boxes never wait for paint.
 *  - Pages paint lazily: the ones near the viewport first (IntersectionObserver),
 *    then — for documents up to `EAGER_PAGE_LIMIT` pages, so printing and the
 *    "ready" callback keep working — the rest in order. Longer documents only
 *    paint what is scrolled near.
 *  - Zoom is CSS first: the boxes resize instantly and the existing bitmap
 *    scales with them; a debounced re-raster then repaints at
 *    `displayWidth × devicePixelRatio`, capped at ≈8 MP per page.
 *  - The document comes from the caller (see `lib/pdfDocCache`); this component
 *    never loads or destroys it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'

import { cn } from '@/lib/utils'

export type PdfSizing =
  /** pages fill the container width */
  | { kind: 'fit' }
  /** the PDF's natural size at 1.5×, capped to the container */
  | { kind: 'natural' }
  /** an explicit CSS width in px (pane zoom) */
  | { kind: 'width'; px: number }

const EAGER_PAGE_LIMIT = 12
const MAX_RASTER_PIXELS = 8_000_000
const RERASTER_DEBOUNCE_MS = 200
const NATURAL_SCALE = 1.5

interface PageSize {
  width: number
  height: number
}

/** Nearest ancestor that scrolls vertically, or null (the viewport). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}

export interface PdfPagesProps {
  doc: PDFDocumentProxy
  sizing: PdfSizing
  className?: string
  pageClassName?: string
  /** Page boxes were laid out (or re-laid out) — overlay hosts re-measure. */
  onLayout?: () => void
  /** The page nearest the top of the viewport changed. */
  onCurrentPage?: (page: number, total: number) => void
  /** Every page that will paint without scrolling has painted. */
  onPainted?: () => void
  /** A page could not be rendered. */
  onError?: (err: unknown) => void
}

export function PdfPages({
  doc,
  sizing,
  className,
  pageClassName,
  onLayout,
  onCurrentPage,
  onPainted,
  onError,
}: PdfPagesProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [pages, setPages] = useState<PDFPageProxy[]>([])
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [visible, setVisible] = useState<number[]>([])
  const [measured, setMeasured] = useState<number | null>(typeof ResizeObserver === 'undefined' ? 0 : null)
  const [rasterWidth, setRasterWidth] = useState<number | null>(null)
  const painted = useRef(new Map<number, number>())

  const onLayoutRef = useRef(onLayout)
  const onCurrentPageRef = useRef(onCurrentPage)
  const onPaintedRef = useRef(onPainted)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onLayoutRef.current = onLayout
    onCurrentPageRef.current = onCurrentPage
    onPaintedRef.current = onPainted
    onErrorRef.current = onError
  })

  // 1 — page proxies + natural sizes (placeholders need the aspect ratio).
  useEffect(() => {
    let cancelled = false
    painted.current = new Map()
    void (async () => {
      try {
        const list = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)))
        if (cancelled) return
        setPages(list)
        setSizes(
          list.map((p) => {
            const vp = p.getViewport({ scale: 1 })
            return { width: vp.width, height: vp.height }
          }),
        )
      } catch (err) {
        if (!cancelled) onErrorRef.current?.(err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc])

  // 2 — container width (fit / natural sizing).
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || sizing.kind === 'width' || typeof ResizeObserver === 'undefined') return
    // 0 = no layout yet (hidden host, jsdom): paint at the natural size, re-raster once it is measured.
    setMeasured(Math.round(host.clientWidth))
    const ro = new ResizeObserver((entries) => {
      setMeasured(Math.round(entries[0]?.contentRect.width ?? host.clientWidth))
    })
    ro.observe(host)
    return () => ro.disconnect()
  }, [sizing.kind])

  // CSS scale instantly, re-raster after the zoom settles (first value is immediate).
  const target = sizing.kind === 'width' ? sizing.px : measured
  useEffect(() => {
    if (target === null || target === rasterWidth) return
    const id = window.setTimeout(() => setRasterWidth(target), rasterWidth === null ? 0 : RERASTER_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [target, rasterWidth])

  // 3 — which pages are near the viewport / which is "current".
  useEffect(() => {
    const host = hostRef.current
    if (!host || sizes.length === 0) return
    const boxes = Array.from(host.querySelectorAll<HTMLElement>('[data-pdf-page]'))
    const total = sizes.length
    if (typeof IntersectionObserver === 'undefined') {
      queueMicrotask(() => {
        setVisible(boxes.map((_, i) => i + 1))
        onCurrentPageRef.current?.(1, total)
      })
      return
    }
    const near = new Set<number>()
    const ratios = new Map<number, number>()
    let current = 0
    const pageOf = (el: Element): number => (el instanceof HTMLElement ? Number(el.dataset.pdfPage) : 0)
    const nearObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) near.add(pageOf(e.target))
          else near.delete(pageOf(e.target))
        }
        setVisible([...near].sort((a, b) => a - b))
      },
      // rootMargin only widens the *root*: use the scroll container so pages just below the fold are "near".
      { root: scrollParent(host), rootMargin: '600px 0px' },
    )
    const countObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(pageOf(e.target), e.intersectionRatio)
        let best = 0
        let bestRatio = 0
        for (const [page, ratio] of [...ratios].sort((a, b) => a[0] - b[0])) {
          if (ratio > bestRatio) {
            best = page
            bestRatio = ratio
          }
        }
        if (best !== 0 && best !== current) {
          current = best
          onCurrentPageRef.current?.(best, total)
        }
      },
      { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    )
    for (const box of boxes) {
      nearObserver.observe(box)
      countObserver.observe(box)
    }
    onCurrentPageRef.current?.(1, total)
    return () => {
      nearObserver.disconnect()
      countObserver.disconnect()
    }
  }, [sizes])

  useLayoutEffect(() => {
    if (sizes.length > 0) onLayoutRef.current?.()
  }, [sizes, rasterWidth])

  // 4 — paint: near pages first, then (short documents) the rest in order.
  const visibleKey = visible.join(',')
  useEffect(() => {
    const host = hostRef.current
    if (!host || pages.length === 0 || rasterWidth === null) return
    let cancelled = false
    let task: RenderTask | null = null
    const near = visibleKey === '' ? [] : visibleKey.split(',').map(Number)
    const rest =
      pages.length <= EAGER_PAGE_LIMIT
        ? pages.map((_, i) => i + 1).filter((n) => !near.includes(n))
        : []
    const order = near.length === 0 && pages.length > EAGER_PAGE_LIMIT ? [1] : [...near, ...rest]

    void (async () => {
      try {
        for (const n of order) {
          if (cancelled) return
          const box = host.querySelector<HTMLElement>(`[data-pdf-page="${n}"]`)
          const page = pages[n - 1]
          if (!box || !page) continue
          const base = page.getViewport({ scale: 1 })
          const cssWidth = rasterWidth > 0 ? rasterWidth : base.width * NATURAL_SCALE
          const target =
            sizing.kind === 'natural' ? Math.min(cssWidth, base.width * NATURAL_SCALE) : cssWidth
          if (painted.current.get(n) === Math.round(target)) continue
          const dpr = window.devicePixelRatio || 1
          const scale = Math.min(
            (target / base.width) * dpr,
            Math.sqrt(MAX_RASTER_PIXELS / (base.width * base.height)),
          )
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.display = 'block'
          canvas.style.width = '100%'
          canvas.style.height = '100%'
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('Canvas 2D context unavailable')
          task = page.render({ canvas, canvasContext: ctx, viewport })
          await task.promise
          task = null
          if (cancelled) return
          // Swap only once the new bitmap is ready: the old one keeps showing meanwhile.
          box.replaceChildren(canvas)
          painted.current.set(n, Math.round(target))
        }
        if (!cancelled) onPaintedRef.current?.()
      } catch (err) {
        if (!cancelled && !(err instanceof Error && err.name === 'RenderingCancelledException')) {
          onErrorRef.current?.(err)
        }
      }
    })()

    return () => {
      cancelled = true
      try {
        task?.cancel()
      } catch {
        // a stub render task without cancel
      }
    }
  }, [pages, rasterWidth, visibleKey, sizing.kind])

  return (
    <div
      ref={hostRef}
      data-pdf-pages
      className={cn('flex flex-col items-center gap-3', className)}
      style={sizing.kind === 'width' ? { width: sizing.px } : { width: '100%' }}
    >
      {sizes.map((size, i) => (
        <div
          key={i}
          data-pdf-page={i + 1}
          className={cn(
            'relative overflow-hidden bg-white print:break-inside-avoid print:break-after-page last:print:break-after-auto',
            pageClassName,
          )}
          style={{
            width:
              sizing.kind === 'fit'
                ? '100%'
                : sizing.kind === 'width'
                  ? sizing.px
                  : `min(${Math.round(size.width * NATURAL_SCALE)}px, 100%)`,
            aspectRatio: `${size.width} / ${size.height}`,
          }}
        />
      ))}
    </div>
  )
}
