import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFPageProxy, RenderTask } from 'pdfjs-dist'

import { DialogRoot, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import type { StoreDeliveryScan, StoreScanLine } from '@/lib/api'
import { pdfWorkerUrl } from '@/lib/pdf'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const MAX_RASTER_PIXELS = 8_000_000

interface Raster {
  image: CanvasImageSource
  width: number
  height: number
}

interface LocalSource {
  page: (index: number) => Promise<Raster>
  dispose: () => void
}

/** Local files deliberately do not enter the server-URL document cache. */
function createLocalSource(file: File, pages: StoreDeliveryScan['pages']): LocalSource {
  let disposed = false
  let loadingTask: PDFDocumentLoadingTask | undefined
  let image: HTMLImageElement | undefined
  let imageUrl: string | undefined
  let rejectImage: ((reason: Error) => void) | undefined
  const rasters = new Map<number, Promise<Raster>>()
  const canvases = new Set<HTMLCanvasElement>()
  const renderTasks = new Set<RenderTask>()
  const pageProxies = new Set<PDFPageProxy>()
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  const aborted = (): DOMException => new DOMException('Aborted', 'AbortError')

  const pdfDocument = isPdf ? file.arrayBuffer().then((buffer) => {
    if (disposed) throw aborted()
    loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableFontFace: true })
    return loadingTask.promise
  }) : null

  const photo = isPdf ? null : new Promise<Raster>((resolve, reject) => {
    rejectImage = reject
    image = new Image()
    imageUrl = URL.createObjectURL(file)
    image.onload = () => {
      if (disposed || !image) return
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        reject(new Error('Empty image'))
        return
      }
      resolve({ image, width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => reject(new Error('Image could not be decoded'))
    image.src = imageUrl
  })

  const page = (index: number): Promise<Raster> => {
    const cached = rasters.get(index)
    if (cached) return cached
    const pending = (async (): Promise<Raster> => {
      if (disposed) throw aborted()
      if (photo) {
        if (index !== 0) throw new Error('Image page unavailable')
        return photo
      }
      const doc = await pdfDocument
      if (disposed) throw aborted()
      if (!doc || !Number.isInteger(index) || index < 0 || index >= doc.numPages) {
        throw new Error('PDF page unavailable')
      }
      const pdfPage = await doc.getPage(index + 1)
      if (disposed) {
        pdfPage.cleanup()
        throw aborted()
      }
      pageProxies.add(pdfPage)
      const base = pdfPage.getViewport({ scale: 1 })
      const ocrSize = pages[index]
      // Match the OCR raster when possible, bounding memory as in PdfPages.
      const desiredScale = ocrSize?.width > 0 ? ocrSize.width / base.width : 1.5
      const scale = Math.min(desiredScale, Math.sqrt(MAX_RASTER_PIXELS / (base.width * base.height)))
      const viewport = pdfPage.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvases.add(canvas)
      canvas.width = Math.max(1, Math.floor(viewport.width))
      canvas.height = Math.max(1, Math.floor(viewport.height))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas unavailable')
      const task = pdfPage.render({ canvas, canvasContext: context, viewport })
      renderTasks.add(task)
      try {
        await task.promise
        if (disposed) throw aborted()
        return { image: canvas, width: canvas.width, height: canvas.height }
      } finally {
        renderTasks.delete(task)
        pdfPage.cleanup()
        pageProxies.delete(pdfPage)
      }
    })()
    rasters.set(index, pending)
    return pending
  }

  return {
    page,
    dispose: () => {
      disposed = true
      for (const task of renderTasks) task.cancel()
      for (const pageProxy of pageProxies) pageProxy.cleanup()
      for (const canvas of canvases) {
        canvas.width = 0
        canvas.height = 0
      }
      rasters.clear()
      canvases.clear()
      if (loadingTask) void loadingTask.destroy().catch(() => undefined)
      if (image) {
        image.onload = null
        image.onerror = null
        image.removeAttribute('src')
      }
      rejectImage?.(aborted())
      if (imageUrl) URL.revokeObjectURL(imageUrl)
    },
  }
}

interface CropProps {
  source: LocalSource | null
  unavailable: boolean
  line: StoreScanLine
  pageSize: StoreDeliveryScan['pages'][number] | undefined
  number: number
}

function ScanRowCrop({ source, unavailable, line, pageSize, number }: CropProps): React.JSX.Element {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<{ source: LocalSource; line: StoreScanLine; ok: boolean } | null>(null)
  const current = result?.source === source && result.line === line ? result : null
  const invalid = !pageSize || !Number.isFinite(pageSize.width) || !Number.isFinite(pageSize.height)
    || pageSize.width <= 0 || pageSize.height <= 0
    || !Object.values(line.bbox).every(Number.isFinite) || line.bbox.w <= 0 || line.bbox.h <= 0

  useEffect(() => {
    const canvas = canvasRef.current
    if (!source || !canvas || invalid || !pageSize) return
    let cancelled = false
    void source.page(line.page).then((raster) => {
      if (cancelled) return
      const { x, y, w, h } = line.bbox
      // OCR may upscale the local image. Map both axes independently and clip
      // in OCR coordinates before sampling, without mirroring under RTL.
      const paddingX = Math.max(8, h * 0.5)
      const paddingY = Math.max(4, h * 0.35)
      const left = Math.max(0, x - paddingX)
      const top = Math.max(0, y - paddingY)
      const right = Math.min(pageSize.width, x + w + paddingX)
      const bottom = Math.min(pageSize.height, y + h + paddingY)
      if (right <= left || bottom <= top) throw new Error('Crop outside page')
      const sx = left * raster.width / pageSize.width
      const sy = top * raster.height / pageSize.height
      const sw = (right - left) * raster.width / pageSize.width
      const sh = (bottom - top) * raster.height / pageSize.height
      // Keep the text at a readable scale, even when the row is much wider
      // than a phone. The viewport scrolls instead of shrinking the image.
      const scale = Math.max(1, 48 / sh)
      canvas.width = Math.max(1, Math.ceil(sw * scale))
      canvas.height = Math.max(48, Math.ceil(sh * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas unavailable')
      context.direction = 'ltr'
      context.drawImage(raster.image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
      setResult({ source, line, ok: true })
    }).catch(() => {
      if (!cancelled) setResult({ source, line, ok: false })
    })
    return () => {
      cancelled = true
      canvas.width = 0
      canvas.height = 0
    }
  }, [source, line, pageSize, invalid])

  if (unavailable || invalid || current?.ok === false) {
    return <p className="mb-3 rounded-md border border-border bg-surface-tinted p-3 text-sm text-muted-foreground">{t('assets.store.scan.cropUnavailable')}</p>
  }

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          dir="ltr"
          disabled={!current?.ok}
          aria-label={`${t('assets.store.scan.cropEnlarge')} ${number}`}
          aria-busy={!current?.ok}
          className="mb-3 block min-h-11 w-full min-w-0 overflow-x-auto rounded-md border border-border bg-surface p-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span dir="auto" className="mb-1 block text-xs font-medium text-foreground">
            {t('assets.store.scan.cropEnlarge')} <bdi dir="ltr">{number}</bdi>
          </span>
          <span dir="ltr" className="block rounded bg-white">
            <canvas
              ref={canvasRef}
              dir="ltr"
              role="img"
              aria-label={t('assets.store.scan.cropAlt', { number })}
              className="block max-w-none"
              style={{ height: 48, visibility: current?.ok ? 'visible' : 'hidden' }}
            />
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-4xl">
        <DialogHeader className="pe-14">
          <DialogTitle>{t('assets.store.scan.cropEnlarge')} <bdi dir="ltr">{number}</bdi></DialogTitle>
          <DialogDescription>{t('assets.store.scan.cropZoomHint')}</DialogDescription>
        </DialogHeader>
        <div dir="ltr" tabIndex={0} className="overflow-auto bg-white p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <canvas
            ref={(canvas) => {
              const preview = canvasRef.current
              if (!canvas || !preview) return
              canvas.width = preview.width * 2
              canvas.height = preview.height * 2
              canvas.getContext('2d')?.drawImage(preview, 0, 0, canvas.width, canvas.height)
            }}
            role="img"
            aria-label={t('assets.store.scan.cropAlt', { number })}
            className="block max-w-none"
            style={{ height: 96 }}
          />
        </div>
      </DialogContent>
    </DialogRoot>
  )
}

/** One local decode per file and one PDF raster per requested page, shared by all rows. */
export function ScanNotePreview({ file, scan, render }: {
  file: File
  scan: StoreDeliveryScan
  render: (crop: (line: StoreScanLine) => ReactNode) => ReactNode
}): ReactNode {
  const [loaded, setLoaded] = useState<{ file: File; pages: StoreDeliveryScan['pages']; source: LocalSource | null } | null>(null)
  const current = loaded?.file === file && loaded.pages === scan.pages ? loaded : null

  useEffect(() => {
    let cancelled = false
    const source = createLocalSource(file, scan.pages)
    // Page 1 is ready even before any row mounts; subsequent pages are lazy.
    void source.page(0).then(() => {
      if (!cancelled) setLoaded({ file, pages: scan.pages, source })
    }).catch(() => {
      if (!cancelled) setLoaded({ file, pages: scan.pages, source: null })
    })
    return () => {
      cancelled = true
      source.dispose()
    }
  }, [file, scan.pages])

  return render((line) => (
    <ScanRowCrop
      source={current?.source ?? null}
      unavailable={current !== null && current.source === null}
      line={line}
      number={scan.lines.indexOf(line) + 1}
      pageSize={scan.pages[line.page]}
    />
  ))
}
