/**
 * Full-page print setup (mockup frames 2 and 4): header bar with Back and
 * Print, settings at inline-start, the live A4 preview on a grey canvas at
 * inline-end, and a sticky result bar stating what will print. On a phone the
 * settings stack above the preview, which scales to the width.
 *
 * The preview is one continuous sheet; page breaks exist only in print. The
 * page count is an estimate: a simulation of print pagination over the
 * rendered rows (a row never splits), not a promise.
 */

import { ArrowLeft, Printer } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { apiErrorMessage } from '@/lib/api'

import type { Orientation } from './printSettings'

const PX_PER_MM = 96 / 25.4

interface Props {
  backTo: string
  backLabel: string
  title: string
  employeeLine: ReactNode
  onPrint: () => void
  printPending: boolean
  printError: unknown
  /** False while data is loading or failed: there is nothing honest to print. */
  canPrint: boolean
  settings: ReactNode
  notices?: ReactNode
  orient: Orientation
  /** Changes whenever the paper's content changes, to re-measure it. */
  paperKey: string
  result: (pages: number) => ReactNode
  paper: ReactNode
}

export function PrintSetupShell({
  backTo,
  backLabel,
  title,
  employeeLine,
  onPrint,
  printPending,
  printError,
  canPrint,
  settings,
  notices,
  orient,
  paperKey,
  result,
  paper,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const canvasRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState({ pages: 1, scale: 1, width: 0, height: 0 })

  useLayoutEffect(() => {
    const measure = (): void => {
      const canvas = canvasRef.current
      const sheet = stageRef.current?.querySelector<HTMLTableElement>('table.statement-sheet')
      if (!canvas || !sheet || !sheet.tHead || !sheet.tFoot) return
      const page = (orient === 'landscape' ? 210 : 297) * PX_PER_MM
      const per = page - sheet.tHead.offsetHeight - sheet.tFoot.offsetHeight - 4 * PX_PER_MM
      let pages = 1
      let used = 0
      for (const row of Array.from(sheet.tBodies[0]?.rows ?? [])) {
        const h = row.offsetHeight
        if (used + h > per && used > 0) {
          pages += 1
          used = 0
        }
        used += h
      }
      const width = sheet.offsetWidth
      const avail = canvas.clientWidth - 32
      const scale = width > 0 && avail > 0 ? Math.min(1, avail / width) : 1
      const height = sheet.offsetHeight
      setLayout((prev) =>
        prev.pages === pages &&
        Math.abs(prev.scale - scale) < 0.001 &&
        prev.width === width &&
        Math.abs(prev.height - height) < 2
          ? prev
          : { pages, scale, width, height },
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined' || !canvasRef.current) return
    const observer = new ResizeObserver(measure)
    observer.observe(canvasRef.current)
    return () => observer.disconnect()
  }, [paperKey, orient])

  const rtl = i18n.dir() === 'rtl'
  const error = printError ? apiErrorMessage(printError) : null

  return (
    <div className="statement-setup flex min-h-0 flex-1 flex-col bg-background">
      <div
        data-print-hide
        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-3 md:px-7"
      >
        <Link
          to={backTo}
          className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-primary hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          {backLabel}
        </Link>
        <h1 className="text-lg font-semibold text-primary">{title}</h1>
        <span className="text-sm text-muted-foreground">{employeeLine}</span>
        <span className="flex-1" />
        <Button onClick={onPrint} disabled={!canPrint || printPending} aria-busy={printPending || undefined}>
          <Printer className="size-4" aria-hidden="true" />
          {printPending ? t('statementPrint.printing') : t('statementPrint.print')}
        </Button>
        {error && (
          <p role="alert" className="basis-full text-sm text-accent">
            {t('statementPrint.printFailed', { message: error })}
          </p>
        )}
      </div>

      {/* Desktop: both columns scroll inside the viewport below the app bar and this header. */}
      <div className="grid min-h-0 flex-1 lg:h-[calc(100dvh-8.25rem)] lg:grid-cols-[400px_minmax(0,1fr)]">
        <aside
          data-print-hide
          aria-label={t('statementPrint.settingsLabel')}
          className="flex flex-col border-border bg-surface lg:min-h-0 lg:overflow-y-auto lg:border-e"
        >
          <div className="flex-1 px-5 pb-2 md:px-6">{settings}</div>
          <div
            aria-live="polite"
            className="border-t border-primary bg-surface px-5 py-3.5 text-sm md:px-6 lg:sticky lg:bottom-0"
          >
            {result(layout.pages)}
          </div>
        </aside>

        <div
          ref={canvasRef}
          role="region"
          aria-label={t('statementPrint.previewLabel')}
          className="statement-canvas min-w-0 bg-[#cdcbc4] px-4 pb-12 pt-6 md:px-7 lg:overflow-auto dark:bg-[#2a2f3a]"
        >
          {notices && (
            <div data-print-hide className="mx-auto mb-4 grid max-w-[210mm] gap-2">
              {notices}
            </div>
          )}
          <div
            className="statement-zoom mx-auto shadow-[0_2px_14px_rgba(20,30,45,0.28)]"
            style={
              layout.width
                ? { width: layout.width * layout.scale, height: layout.height * layout.scale }
                : undefined
            }
          >
            <div
              ref={stageRef}
              className="statement-stage"
              style={{
                transform: layout.scale < 1 ? `scale(${layout.scale})` : undefined,
                transformOrigin: rtl ? 'top right' : 'top left',
                width: layout.width || undefined,
              }}
            >
              {paper}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** A quiet notice above the preview. Errors are announced (`role="alert"`) and their copy names what failed. */
export function SetupNotice({
  children,
  tone = 'info',
  action,
}: {
  children: ReactNode
  tone?: 'info' | 'error'
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={
        tone === 'error'
          ? 'flex flex-wrap items-center gap-3 rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-foreground'
          : 'flex flex-wrap items-center gap-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-foreground'
      }
    >
      <span className="flex-1">{children}</span>
      {action}
    </div>
  )
}
