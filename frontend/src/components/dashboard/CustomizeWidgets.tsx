import { useEffect, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Check, ChevronDown, GripVertical, MoreHorizontal, X } from 'lucide-react'
import type { DashboardWidgetConfig } from '@/lib/api'
import {
  CANVAS_WIDTHS,
  WIDGET_SIZES,
  type CanvasWidth,
  type WidgetId,
  type WidgetSize,
  type WidgetSource,
} from '@/lib/dashboardLayout'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { bidi } from '@/lib/bidi'
import { SheetTrigger } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const CONTROL = 'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-7 sm:min-w-7 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 disabled:opacity-40'
const BUTTON = 'inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-hairline bg-surface px-3 text-[0.78em] font-medium text-foreground hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 [@media(pointer:coarse)]:min-h-11 disabled:opacity-50'
const MENU_ITEM = 'min-h-11 sm:min-h-8 [@media(pointer:coarse)]:min-h-11'

export function CustomizeBanner({
  width,
  onWidth,
  onReset,
  onCancel,
  onSave,
  isSaving,
}: {
  width: CanvasWidth
  onWidth: (width: CanvasWidth) => void
  onReset: () => void
  onCancel: () => void
  onSave: () => void
  isSaving: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 639px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)')
    const onChange = () => setPhone(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  const actions = (
    <div className="fixed inset-x-3 bottom-[calc(5.5rem+var(--safe-bottom))] z-40 flex items-center justify-end gap-2 rounded-xl border border-border bg-surface p-2 shadow-sm sm:static sm:border-0 sm:p-0 sm:shadow-none">
      <SheetTrigger asChild>
        <button type="button" data-control="add" disabled={isSaving} className={`${BUTTON} me-auto sm:hidden`}>
          {t('dashboard.customize.addWidget')}
        </button>
      </SheetTrigger>
      <button type="button" onClick={onCancel} disabled={isSaving} className={BUTTON}>
        {t('dashboard.customize.cancel')}
      </button>
      <button
        type="button"
        data-control="save"
        onClick={onSave}
        disabled={isSaving}
        className={`${BUTTON} !bg-primary !text-primary-foreground hover:!bg-primary-hover`}
      >
        {t('dashboard.customize.save')}
      </button>
    </div>
  )
  return (
    <section
      aria-label={t('dashboard.customize.title')}
      className="mb-3.5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3"
    >
      <p className="min-w-0 basis-full text-[0.78em] text-muted-foreground sm:flex-1">
        <strong className="font-semibold text-foreground">
          {t('dashboard.customize.title')}
        </strong>{' '}
        {t('dashboard.customize.hint')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <fieldset
          className="flex shrink-0 gap-1 rounded-full border border-hairline p-1"
          disabled={isSaving}
        >
          <legend className="sr-only">{t('dashboard.customize.width')}</legend>
          {CANVAS_WIDTHS.map((option) => (
            <label
              key={option}
              className={`relative inline-flex min-h-11 cursor-pointer items-center rounded-full px-3 text-[0.72em] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring sm:min-h-7 [@media(pointer:coarse)]:min-h-11 ${
                width === option ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
              }`}
            >
              <input
                type="radio"
                name="dashboard-canvas"
                value={option}
                checked={width === option}
                onChange={() => onWidth(option)}
                className="sr-only"
              />
              {t(`dashboard.customize.${option}`)}
            </label>
          ))}
        </fieldset>
        <button type="button" onClick={onReset} disabled={isSaving} className={BUTTON}>
          {t('dashboard.customize.reset')}
        </button>
      </div>
      {phone ? createPortal(actions, document.body) : actions}
    </section>
  )
}

const SIZE_DIMENSIONS: Partial<Record<WidgetSize, string>> = { S: '1×1', M: '2×1', L: '2×2' }

/** Localised size name; the columns×rows run stays LTR so Arabic never reads 2×1 as 1×2. */
function useSizeLabel(): (size: WidgetSize) => string {
  const { t } = useTranslation()
  return (size) => t(`dashboard.customize.sizes.${size}`, { dims: bidi(SIZE_DIMENSIONS[size] ?? '') })
}

function SizeFootprint({ size }: { size: WidgetSize }): React.JSX.Element {
  const width = size === 'S' ? 6 : size === 'W' || size === 'XL' ? 24 : 12
  const height = size === 'L' || size === 'XL' ? 12 : 6
  return (
    <svg aria-hidden="true" width="16" height="12" viewBox="0 0 24 12" className="shrink-0 rtl:-scale-x-100">
      <rect x="0.5" y="0.5" width={width - 1} height={height - 1} rx="1" fill="currentColor" fillOpacity="0.15" stroke="currentColor" />
    </svg>
  )
}

export function WidgetControls({
  item,
  title,
  atStart,
  atEnd,
  onSize,
  onMove,
  onRemove,
  onEditTiles,
  isSaving,
}: {
  item: DashboardWidgetConfig
  title: string
  atStart: boolean
  atEnd: boolean
  onSize: (size: WidgetSize) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
  onEditTiles?: () => void
  isSaving: boolean
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const sizeLabel = useSizeLabel()
  const preserveFocus = useRef(false)
  const startDrag = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData('text/plain', item.id)
    event.dataTransfer.effectAllowed = 'move'
  }
  const remove = () => {
    preserveFocus.current = true
    onRemove()
  }

  return (
    <div
      className="flex min-h-11 shrink-0 items-center gap-1 border-b border-hairline bg-surface-raised px-2 py-1 sm:min-h-10"
      role="group"
      aria-label={t('dashboard.customize.controls', { name: title })}
    >
      <button
        type="button"
        data-control="drag"
        draggable={!isSaving}
        disabled={isSaving}
        aria-label={t('dashboard.customize.drag', { name: title })}
        title={t('dashboard.customize.drag', { name: title })}
        className={`${CONTROL} cursor-grab active:cursor-grabbing max-sm:hidden`}
        onDragStart={startDrag}
      >
        <GripVertical aria-hidden className="size-3.5" />
      </button>
      <h4 title={title} className="line-clamp-3 min-w-0 flex-1 break-words text-start text-[0.8125em] font-semibold leading-tight text-foreground">
        {title}
      </h4>
      <DropdownMenu dir={i18n.dir()} modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-control="menu"
            disabled={isSaving}
            aria-label={t('dashboard.customize.editWidget', { name: title })}
            title={sizeLabel(item.size)}
            className={CONTROL}
          >
            <MoreHorizontal aria-hidden className="size-4 sm:hidden" />
            <span aria-hidden className="hidden items-center gap-0.5 sm:inline-flex">
              <SizeFootprint size={item.size} />
              <ChevronDown className="size-3" />
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            if (preserveFocus.current) event.preventDefault()
            preserveFocus.current = false
          }}
        >
          <div role="group" aria-label={t('dashboard.customize.size', { name: title })}>
            {WIDGET_SIZES.map((size) => (
              <DropdownMenuItem
                key={size}
                role="menuitemradio"
                aria-checked={item.size === size}
                disabled={isSaving}
                className={MENU_ITEM}
                onSelect={() => onSize(size)}
              >
                <SizeFootprint size={size} />
                {sizeLabel(size)}
                {item.size === size && <Check aria-hidden className="ms-auto size-3.5" />}
              </DropdownMenuItem>
            ))}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-control="earlier"
            disabled={atStart || isSaving}
            aria-label={t('dashboard.customize.earlier', { name: title })}
            className={MENU_ITEM}
            onSelect={() => { preserveFocus.current = true; onMove(-1) }}
          >
            <ArrowUp aria-hidden className="size-3.5" />
            {t('dashboard.customize.earlierLabel')}
          </DropdownMenuItem>
          <DropdownMenuItem
            data-control="later"
            disabled={atEnd || isSaving}
            aria-label={t('dashboard.customize.later', { name: title })}
            className={MENU_ITEM}
            onSelect={() => { preserveFocus.current = true; onMove(1) }}
          >
            <ArrowDown aria-hidden className="size-3.5" />
            {t('dashboard.customize.laterLabel')}
          </DropdownMenuItem>
          {onEditTiles && (
            <DropdownMenuItem onSelect={onEditTiles} disabled={isSaving} className={MENU_ITEM}>
              {t('dashboard.customize.editTiles')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            aria-label={t('dashboard.customize.remove', { name: title })}
            disabled={isSaving}
            onSelect={remove}
            className={MENU_ITEM}
            variant="danger"
          >
            <X aria-hidden className="size-3.5" />
            {t('dashboard.customize.removeLabel')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={isSaving}
              aria-label={t('dashboard.customize.remove', { name: title })}
              className={`${CONTROL} max-sm:hidden`}
              onClick={onRemove}
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </TooltipTrigger>
          {createPortal(<TooltipContent>{t('dashboard.customize.remove', { name: title })}</TooltipContent>, document.body)}
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

export interface WidgetCatalogEntry {
  id: WidgetId
  title: string
  source: WidgetSource
}

export function AddWidgetsPanel({ entries, widgets, onAdd, isSaving }: {
  entries: WidgetCatalogEntry[]
  widgets: DashboardWidgetConfig[]
  onAdd: (id: WidgetId) => void
  isSaving: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const onBoard = new Set(widgets.filter((widget) => widget.visible).map((widget) => widget.id))
  const available = entries.filter((entry) => !onBoard.has(entry.id))
  const added = entries.filter((entry) => onBoard.has(entry.id))
  const sources = [...new Set(available.map((entry) => entry.source))]
  return (
    <aside
      aria-label={t('dashboard.customize.addTitle')}
      className="w-full shrink-0 rounded-2xl border border-border bg-surface p-4 lg:sticky lg:top-4 lg:max-h-[75vh] lg:w-64 lg:overflow-y-auto"
    >
      <h3 className="font-semibold text-foreground">{t('dashboard.customize.addTitle')}</h3>
      <p className="mt-1 text-[0.75em] text-muted-foreground">
        {t('dashboard.customize.addHint')}
      </p>
      <section aria-label={t('dashboard.customize.available', { count: available.length })}>
        <h4 className="mt-4 text-[0.8125em] font-semibold text-foreground">
          {t('dashboard.customize.available', { count: available.length })}
        </h4>
        {available.length === 0 && (
          <p className="mt-2 text-[0.75em] text-muted-foreground">{t('dashboard.customize.noneAvailable')}</p>
        )}
        {sources.map((source) => (
          <section key={source} aria-label={t(`dashboard.customize.sources.${source}`)} className="mt-3">
            <h5 className="mb-1 text-[0.75em] font-medium text-muted-foreground">
              {t(`dashboard.customize.sources.${source}`)}
            </h5>
            <ul className="divide-y divide-hairline">
              {available.filter((entry) => entry.source === source).map((entry) => (
                <li key={entry.id} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 text-[0.8125em] font-medium text-foreground">{entry.title}</span>
                  <button
                    type="button"
                    data-add-widget-id={entry.id}
                    disabled={isSaving}
                    onClick={() => onAdd(entry.id)}
                    aria-label={t('dashboard.customize.addAria', { name: entry.title })}
                    className={`${BUTTON} min-w-11 !px-2`}
                  >
                    {t('dashboard.customize.add')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>
      <details className="group mt-4 border-t border-hairline pt-2">
        <summary className="flex min-h-11 cursor-pointer items-center text-[0.8125em] font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 [@media(pointer:coarse)]:min-h-11">
          <ChevronDown aria-hidden className="me-2 size-3.5 shrink-0 -rotate-90 rtl:rotate-90 group-open:rotate-0" />
          {t('dashboard.customize.onDashboard', { count: added.length })}
        </summary>
        <ul className="mt-2 space-y-3">
          {added.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2 text-[0.8125em] text-muted-foreground">
              <Check aria-hidden className="size-3.5 shrink-0" />
              {entry.title}
            </li>
          ))}
        </ul>
      </details>
    </aside>
  )
}
