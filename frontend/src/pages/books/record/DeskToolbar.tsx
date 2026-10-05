/**
 * DeskToolbar — the strip above the paper on the record page (md and up), plus
 * the paper chip row shared with the phone desk and the full-screen viewer.
 *
 *   [switcher | label] caption · marks stepper · armed Mark tools   ···
 *   page counter · zoom − / Fit|% / + · 100% · Download · Open in new tab · Focus
 *
 * The record body is pinned `direction:ltr`, so the toolbar re-asserts `dir`.
 * Everything is controlled by `RecordDesk`; this file owns no state.
 */

import { BadgeCheck, Download, ExternalLink, FileText, Maximize2, Minimize2, Minus, Plus, ScanLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Hint } from '@/components/ui/hint'
import { IconAction } from '@/components/ui/icon-action'
import { cn } from '@/lib/utils'

import { paperKey, type Paper, type PaperKey } from '../recordPapers'

export interface PaperCaption {
  text: React.ReactNode
  /** the paper is the signed copy — rendered in the success tone, always with its words */
  ok: boolean
}

function PaperIcon({ kind, className }: { kind: Paper['kind']; className?: string }): React.JSX.Element {
  if (kind === 'signed') return <BadgeCheck className={className} aria-hidden />
  if (kind === 'scan') return <ScanLine className={className} aria-hidden />
  return <FileText className={className} aria-hidden />
}

/**
 * The paper switcher: signed copy first (the order is `papersOf`'s), selection
 * by key. `segmented` (desktop toolbar) or `chips` (44px phone row / full-screen
 * viewer). Callers render nothing for a single paper.
 */
export function PaperSwitcher({
  papers,
  labels,
  selectedKey,
  onSelect,
  variant,
  dark = false,
}: {
  papers: readonly Paper[]
  labels: readonly string[]
  selectedKey: PaperKey | null
  onSelect: (key: PaperKey) => void
  variant: 'segmented' | 'chips'
  dark?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const chips = variant === 'chips'
  return (
    <div
      role="group"
      aria-label={t('books.pane.papers', { count: papers.length })}
      data-paper-switcher
      className={cn(
        chips
          ? 'flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none]'
          : 'inline-flex gap-0.5 rounded-[11px] bg-surface-tinted p-[3px]',
      )}
    >
      {papers.map((p, i) => {
        const on = paperKey(p) === selectedKey
        return (
          <button
            key={paperKey(p)}
            type="button"
            aria-pressed={on}
            data-paper-key={paperKey(p)}
            onClick={() => onSelect(paperKey(p))}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
              chips
                ? 'min-h-11 rounded-full border px-3.5 text-[0.8em]'
                : 'h-8 rounded-lg px-2.5 text-[0.75em]',
              chips
                ? dark
                  ? on
                    ? 'border-transparent bg-[#e6e9f2] text-[#0f131b]'
                    : 'border-[#2e3442] bg-[#1f2533] text-[#e6e9f2]'
                  : on
                    ? p.kind === 'signed'
                      ? 'border-transparent bg-success text-white'
                      : 'border-transparent bg-primary text-primary-foreground'
                    : 'border-border bg-surface text-foreground'
                : on
                  ? cn('bg-surface shadow-sm', p.kind === 'signed' ? 'text-success' : 'text-foreground')
                  : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <PaperIcon kind={p.kind} className="h-3.5 w-3.5" />
            {labels[i]}
          </button>
        )
      })}
    </div>
  )
}

function LinkAction({
  href,
  download,
  newTab,
  label,
  children,
}: {
  href: string
  download?: string
  newTab?: boolean
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Hint label={label} side="bottom">
      <a
        href={href}
        download={download}
        {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : null)}
        aria-label={label}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface text-primary transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        {children}
      </a>
    </Hint>
  )
}

export interface DeskToolbarProps {
  dir: 'ltr' | 'rtl'
  papers: readonly Paper[]
  labels: readonly string[]
  selectedKey: PaperKey | null
  onSelect: (key: PaperKey) => void
  /** the paper on the desk (undefined while a live draft replaces it, or with none) */
  paper: Paper | undefined
  caption: PaperCaption | null
  /** current page / page count of the PDF on the desk */
  page: { page: number; total: number } | null
  zoom: 'fit' | number
  /** the desk shows a PDF (zoom, page counter and Open apply) */
  zoomable: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onActualSize: () => void
  /** "N marks from X" stepper */
  marks?: React.ReactNode
  /** Mark tools while armed */
  tools?: React.ReactNode
  focus: boolean
  onToggleFocus: () => void
}

export function DeskToolbar({
  dir,
  papers,
  labels,
  selectedKey,
  onSelect,
  paper,
  caption,
  page,
  zoom,
  zoomable,
  onZoomIn,
  onZoomOut,
  onFit,
  onActualSize,
  marks,
  tools,
  focus,
  onToggleFocus,
}: DeskToolbarProps): React.JSX.Element {
  const { t } = useTranslation()
  const selectedIndex = papers.findIndex((p) => paperKey(p) === selectedKey)
  const singleLabel = labels[selectedIndex === -1 ? 0 : selectedIndex]
  const downloadLabel = paper
    ? `${t('books.paper.download')} · ${labels[papers.indexOf(paper)] ?? paper.filename}`
    : t('books.paper.download')
  const focusLabel = focus ? t('books.record.exitFocus') : t('books.record.focus')
  const percent = zoom === 'fit' ? null : Math.round(zoom * 100)

  return (
    <div
      dir={dir}
      data-print-hide
      data-desk-toolbar
      className="z-10 flex flex-none flex-wrap items-center gap-2 border-b border-hairline bg-surface/85 px-3.5 py-2 backdrop-blur max-md:hidden"
    >
      {papers.length > 1 ? (
        <PaperSwitcher
          papers={papers}
          labels={labels}
          selectedKey={selectedKey}
          onSelect={onSelect}
          variant="segmented"
        />
      ) : singleLabel && papers.length === 1 ? (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-surface-tinted px-2.5 text-[0.75em] font-semibold text-foreground">
          <PaperIcon kind={papers[0].kind} className="h-3.5 w-3.5" />
          {singleLabel}
        </span>
      ) : null}

      {caption?.text ? (
        <span
          className={cn(
            'min-w-0 truncate text-[0.75em]',
            caption.ok ? 'font-semibold text-success' : 'text-muted-foreground',
          )}
        >
          {caption.text}
        </span>
      ) : null}
      {marks}
      {tools}

      <span className="flex-1" />

      {zoomable && page && page.total > 0 ? (
        <span className="whitespace-nowrap px-1 font-mono text-[0.75em] font-semibold text-muted-foreground">
          <span className="sr-only">{t('books.paper.pageOf', { i: page.page, n: page.total })}</span>
          <bdi dir="ltr" aria-hidden className="tabular-nums">
            {page.page} / {page.total}
          </bdi>
        </span>
      ) : null}

      {zoomable ? (
        <div className="inline-flex h-8 items-center rounded-[10px] border border-hairline bg-surface">
          <IconAction
            aria-label={t('books.pane.zoomOut')}
            shortcut="-"
            hintSide="bottom"
            onClick={onZoomOut}
            className="h-[1.625rem] w-[1.625rem] border-0"
          >
            <Minus className="h-3.5 w-3.5" aria-hidden />
          </IconAction>
          <Hint label={t('books.paper.fitWidth')} shortcut="0" side="bottom">
            <button
              type="button"
              aria-label={t('books.paper.fitWidth')}
              aria-pressed={zoom === 'fit'}
              onClick={onFit}
              className="inline-flex h-[1.625rem] min-w-[2.75rem] items-center justify-center rounded-lg px-1.5 font-mono text-[0.6875rem] font-semibold tabular-nums text-muted-foreground hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              {percent === null ? t('books.pane.fit') : <bdi dir="ltr">{percent}%</bdi>}
            </button>
          </Hint>
          <IconAction
            aria-label={t('books.pane.zoomIn')}
            shortcut="="
            hintSide="bottom"
            onClick={onZoomIn}
            className="h-[1.625rem] w-[1.625rem] border-0"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </IconAction>
          <span aria-live="polite" className="sr-only">
            {percent === null ? t('books.paper.fitWidth') : `${percent}%`}
          </span>
        </div>
      ) : null}
      {zoomable ? (
        <button
          type="button"
          aria-pressed={zoom === 1}
          onClick={onActualSize}
          className={cn(
            'hidden h-8 items-center rounded-lg border border-hairline px-2 font-mono text-[0.6875rem] font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none min-[1180px]:inline-flex',
            zoom === 1 ? 'bg-surface-tinted text-foreground' : 'bg-surface text-muted-foreground hover:bg-surface-tinted',
          )}
        >
          <bdi dir="ltr">{t('books.paper.actualSize')}</bdi>
        </button>
      ) : null}

      {paper ? (
        <LinkAction href={paper.downloadUrl} download={paper.filename} label={downloadLabel}>
          <Download className="h-4 w-4" aria-hidden />
        </LinkAction>
      ) : null}
      {paper && zoomable ? (
        <LinkAction href={paper.url} newTab label={t('books.paper.openNewTab')}>
          <ExternalLink className="h-4 w-4" aria-hidden />
        </LinkAction>
      ) : null}

      <Hint label={focusLabel} shortcut="F" side="bottom">
        <button
          type="button"
          aria-pressed={focus}
          aria-label={focusLabel}
          onClick={onToggleFocus}
          className={cn(
            'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-[0.75em] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
            focus
              ? 'border-primary/40 bg-primary-soft text-primary'
              : 'border-hairline bg-surface text-foreground hover:bg-surface-tinted',
          )}
        >
          {focus ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}
          <span className="hidden min-[1180px]:inline">{focusLabel}</span>
        </button>
      </Hint>
    </div>
  )
}
