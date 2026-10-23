import type { DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react'
import type { DashboardWidgetConfig } from '@/lib/api'
import {
  CANVAS_WIDTHS,
  WIDGET_SIZES,
  type CanvasWidth,
  type WidgetId,
  type WidgetSize,
  type WidgetSource,
} from '@/lib/dashboardLayout'

const CONTROL = 'inline-flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-40 disabled:opacity-40'
const BUTTON = 'rounded-full border border-hairline bg-surface px-3 py-1.5 text-[0.78em] font-medium text-primary hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

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
  return (
    <section
      aria-label={t('dashboard.customize.title')}
      className="mb-3.5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3"
    >
      <p className="min-w-0 flex-1 text-[0.78em] text-muted-foreground">
        <strong className="font-semibold text-foreground">
          {t('dashboard.customize.title')}
        </strong>{' '}
        {t('dashboard.customize.hint')}
      </p>
      <fieldset
        className="flex shrink-0 gap-1 rounded-full border border-hairline p-1"
        disabled={isSaving}
      >
        <legend className="sr-only">{t('dashboard.customize.width')}</legend>
        {CANVAS_WIDTHS.map((option) => (
          <label
            key={option}
            className={`relative cursor-pointer rounded-full px-3 py-1 text-[0.72em] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
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
      <button type="button" onClick={onCancel} disabled={isSaving} className={BUTTON}>
        {t('dashboard.customize.cancel')}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={isSaving}
        className={`${BUTTON} !bg-primary !text-primary-foreground hover:!bg-primary-hover`}
      >
        {t('dashboard.customize.save')}
      </button>
    </section>
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
  const { t } = useTranslation()
  const startDrag = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData('text/plain', item.id)
    event.dataTransfer.effectAllowed = 'move'
  }
  const moveEarlier = () => {
    if (!atStart && !isSaving) onMove(-1)
  }
  const moveLater = () => {
    if (!atEnd && !isSaving) onMove(1)
  }

  return (
    <div
      className="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center justify-center gap-0.5 border-b border-hairline bg-surface-raised px-1 py-1.5"
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
        className={`${CONTROL} cursor-grab active:cursor-grabbing`}
        onDragStart={startDrag}
      >
        <GripVertical aria-hidden className="size-3.5" />
      </button>
      <fieldset disabled={isSaving} className="flex rounded-full border border-border">
        <legend className="sr-only">
          {t('dashboard.customize.size', { name: title })}
        </legend>
        {WIDGET_SIZES.map((size) => (
          <label
            key={size}
            className={`cursor-pointer rounded-full px-1.5 py-0.5 font-mono text-[0.65em] font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
              item.size === size ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
            }`}
          >
            <input
              type="radio"
              name={`widget-size-${item.id}`}
              value={size}
              checked={item.size === size}
              onChange={() => onSize(size)}
              aria-label={t(`dashboard.customize.sizes.${size}`)}
              className="sr-only"
            />
            {size}
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        data-control="earlier"
        aria-disabled={atStart || isSaving}
        aria-label={t('dashboard.customize.earlier', { name: title })}
        className={CONTROL}
        onClick={moveEarlier}
      >
        <ArrowUp aria-hidden className="size-3.5" />
      </button>
      <button
        type="button"
        data-control="later"
        aria-disabled={atEnd || isSaving}
        aria-label={t('dashboard.customize.later', { name: title })}
        className={CONTROL}
        onClick={moveLater}
      >
        <ArrowDown aria-hidden className="size-3.5" />
      </button>
      <button
        type="button"
        disabled={isSaving}
        aria-label={t('dashboard.customize.remove', { name: title })}
        className={CONTROL}
        onClick={onRemove}
      >
        <X aria-hidden className="size-3.5" />
      </button>
      {onEditTiles && (
        <button
          type="button"
          onClick={onEditTiles}
          disabled={isSaving}
          className="rounded px-1 text-[0.65em] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('dashboard.customize.editTiles')}
        </button>
      )}
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
  const sources = [...new Set(entries.map((entry) => entry.source))]
  return (
    <aside
      aria-label={t('dashboard.customize.addTitle')}
      className="w-full shrink-0 rounded-2xl border border-border bg-surface p-4 lg:sticky lg:top-4 lg:max-h-[75vh] lg:w-64 lg:overflow-y-auto"
    >
      <h3 className="font-semibold text-foreground">{t('dashboard.customize.addTitle')}</h3>
      <p className="mt-1 text-[0.72em] text-muted-foreground">
        {t('dashboard.customize.addHint')}
      </p>
      {sources.map((source) => (
        <section
          key={source}
          aria-label={t(`dashboard.customize.sources.${source}`)}
          className="mt-4"
        >
          <h4 className="mb-2 text-[0.7em] font-semibold uppercase tracking-wide text-muted-foreground">
            {t(`dashboard.customize.sources.${source}`)}
          </h4>
          <ul className="space-y-2">
            {entries.filter((entry) => entry.source === source).map((entry) => {
              const visible = widgets.some((widget) => widget.id === entry.id && widget.visible)
              return (
                <li
                  key={entry.id}
                  className="flex items-center gap-2 rounded-lg border border-hairline bg-surface-raised p-2"
                >
                  <span className="min-w-0 flex-1 text-[0.75em] font-medium text-foreground">
                    {entry.title}
                  </span>
                  <button
                    type="button"
                    disabled={visible || isSaving}
                    onClick={() => onAdd(entry.id)}
                    aria-label={t(
                      visible ? 'dashboard.customize.onBoardAria' : 'dashboard.customize.addAria',
                      { name: entry.title },
                    )}
                    className={`${BUTTON} !px-2 !text-[0.7em]`}
                  >
                    {t(visible ? 'dashboard.customize.onBoard' : 'dashboard.customize.add')}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </aside>
  )
}
