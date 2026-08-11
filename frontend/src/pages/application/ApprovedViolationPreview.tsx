import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Loader2 } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

interface ApprovedViolationPreviewProps {
  file: File
}

let nextFileId = 1
const fileIds = new WeakMap<File, number>()

function fileIdentity(file: File): number {
  const existing = fileIds.get(file)
  if (existing !== undefined) return existing
  const id = nextFileId
  nextFileId += 1
  fileIds.set(file, id)
  return id
}

function ImagePage({ file }: { file: File }): React.JSX.Element {
  const [url] = useState(() => URL.createObjectURL(file))
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return (
    <img
      src={url}
      alt={file.name}
      className="max-h-[36rem] max-w-full rounded-lg bg-white object-contain shadow-lg"
    />
  )
}

function PdfPage({ file }: { file: File }): React.JSX.Element {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    let renderTask: { cancel: () => void } | null = null
    let loadingTask: { destroy: () => Promise<void> } | null = null
    let pdfDocument: { destroy: () => Promise<void> } | null = null

    void (async () => {
      try {
        const data = new Uint8Array(await file.arrayBuffer())
        if (cancelled) return
        const task = pdfjsLib.getDocument({ data, disableFontFace: true })
        loadingTask = task
        const pdf = await task.promise
        pdfDocument = pdf
        const page = await pdf.getPage(1)
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d')
        if (!canvas || !context) throw new Error('Canvas 2D context unavailable')
        const viewport = page.getViewport({ scale: 1 })
        const dpr = window.devicePixelRatio || 1
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        const taskRender = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        })
        renderTask = taskRender
        await taskRender.promise
        if (!cancelled) setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
      void pdfDocument?.destroy()
      void loadingTask?.destroy()
    }
  }, [file])

  return (
    <>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${t('application.approvedViolation.preview')}: ${file.name}`}
        className={`h-auto max-w-full rounded-lg bg-white shadow-lg ${
          status === 'ready' ? 'block' : 'invisible'
        }`}
      />
      {status === 'loading' && (
        <div
          role="status"
          className="absolute inset-0 grid place-items-center text-sm text-muted-foreground"
        >
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            {t('application.approvedViolation.previewLoading')}
          </span>
        </div>
      )}
      {status === 'error' && (
        <div
          role="alert"
          className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-accent"
        >
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" aria-hidden />
            {t('application.approvedViolation.previewError')}
          </span>
        </div>
      )}
    </>
  )
}

export function ApprovedViolationPreview({
  file,
}: ApprovedViolationPreviewProps): React.JSX.Element {
  const { t } = useTranslation()
  const image =
    file.type === 'image/png' || file.type === 'image/jpeg' || /\.(png|jpe?g)$/i.test(file.name)
  const identity = fileIdentity(file)

  return (
    <section
      className="overflow-hidden rounded-2xl border border-border bg-surface-tinted"
      aria-label={t('application.approvedViolation.preview')}
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">
          {t('application.approvedViolation.preview')}
        </h3>
        <span className="max-w-[55%] truncate font-mono text-xs text-muted-foreground" dir="ltr">
          {file.name}
        </span>
      </header>
      <div className="relative grid min-h-72 place-items-center overflow-auto bg-muted/35 p-4">
        {image ? (
          <ImagePage key={identity} file={file} />
        ) : (
          <PdfPage key={identity} file={file} />
        )}
      </div>
    </section>
  )
}
