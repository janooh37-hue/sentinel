/**
 * CustomizeWidgetsDialog — dashboard widget editor.
 *
 * Two ways to find a widget, because placement and provenance are different
 * questions. Grouped by **placement** (the default) the rows sit under zone
 * headers: Top (max 2, big-card-eligible only), Under Workspace (max 6),
 * Under Quick Actions (max 6), Hidden — with up/down reorder inside each
 * group. Grouped by **source** they sit under the destination they report on
 * (Employees / Leaves / Records / Ledger), which is how an operator actually
 * looks for one; reorder is placement-only, so the arrows are not offered
 * there. Either way the zone <select> both places and shows/hides a widget.
 *
 * The dialog also owns the canvas measure (compact 1180px column vs wide,
 * full-window) since that is a layout decision, not a per-widget one. Save
 * runs `normalizeWidgets` so the persisted layout always satisfies caps +
 * top-eligibility.
 *
 * The quick-action tiles keep using the generic WidgetEditDialog; this dialog
 * is widgets-only.
 */

import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'

import type { DashboardWidgetConfig } from '@/lib/api'
import {
  CANVAS_WIDTHS,
  DEFAULT_CANVAS_WIDTH,
  DEFAULT_LAYOUT,
  MAX_PER_LOWER_ZONE,
  MAX_TOP,
  TOP_ELIGIBLE_SET,
  WIDGET_IDS,
  WIDGET_SOURCE,
  WIDGET_SOURCES,
  type CanvasWidth,
  type WidgetId,
  type WidgetSource,
  type WidgetZone,
  groupForEditor,
  normalizeWidgets,
} from '@/lib/dashboardLayout'

export interface CustomizeWidgetsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: DashboardWidgetConfig[]
  labels: Record<string, string>
  canvasWidth: CanvasWidth
  onSave: (items: DashboardWidgetConfig[], canvasWidth: CanvasWidth) => void
  isSaving?: boolean
}

type GroupBy = 'placement' | 'source'
const GROUP_BY_OPTIONS: GroupBy[] = ['placement', 'source']

type EditorZone = WidgetZone | 'hidden'
const EDITOR_ZONES: EditorZone[] = [
  'top',
  'under_workspace',
  'under_quick_actions',
  'hidden',
]

const OUTLINE_PILL =
  'inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2 text-[0.82em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY_PILL =
  'inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-[0.85em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

export function CustomizeWidgetsDialog(
  props: CustomizeWidgetsDialogProps,
): React.JSX.Element {
  const { open, onOpenChange } = props
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150 motion-reduce:animate-none" />
        {open && <Body {...props} />}
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function editorZoneOf(w: DashboardWidgetConfig): EditorZone {
  if (!w.visible) return 'hidden'
  const z = (w as { zone?: WidgetZone }).zone
  return z ?? 'under_workspace'
}

function Body({
  items,
  labels,
  canvasWidth,
  onSave,
  isSaving,
}: CustomizeWidgetsDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  // Local draft — array order encodes within-zone ordering. Fresh on mount.
  const [draft, setDraft] = useState<DashboardWidgetConfig[]>(() =>
    [...items].sort((a, b) => a.order - b.order),
  )

  const [width, setWidth] = useState<CanvasWidth>(canvasWidth)
  const [groupBy, setGroupBy] = useState<GroupBy>('placement')

  const groups = useMemo(() => groupForEditor(draft), [draft])

  // Same rows, keyed by the destination each widget reports on. Sorted by the
  // draft order so the list is stable while zones are being reassigned.
  const bySource = useMemo(() => {
    const out = {} as Record<WidgetSource, DashboardWidgetConfig[]>
    for (const source of WIDGET_SOURCES) out[source] = []
    for (const w of [...draft].sort((a, b) => a.order - b.order)) {
      const source = WIDGET_SOURCE[w.id as WidgetId]
      if (source) out[source].push(w)
    }
    return out
  }, [draft])

  // Visible counts per zone, for disabling full move-targets.
  const counts = useMemo(() => {
    const c = { top: 0, under_workspace: 0, under_quick_actions: 0 }
    for (const w of draft) {
      const z = editorZoneOf(w)
      if (z !== 'hidden') c[z] += 1
    }
    return c
  }, [draft])

  const setZone = (id: string, target: EditorZone) => {
    setDraft((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w
        if (target === 'hidden') return { ...w, visible: false }
        return { ...w, visible: true, zone: target }
      }),
    )
  }

  const move = (id: string, dir: -1 | 1) => {
    setDraft((prev) => {
      const zone = editorZoneOf(prev.find((w) => w.id === id)!)
      // Indices in the full array that share this editor-zone.
      const idxs = prev
        .map((w, i) => ({ i, z: editorZoneOf(w) }))
        .filter((x) => x.z === zone)
        .map((x) => x.i)
      const pos = idxs.findIndex((i) => prev[i]!.id === id)
      const swapWith = idxs[pos + dir]
      if (swapWith == null) return prev
      const next = [...prev]
      const here = idxs[pos]!
      ;[next[here], next[swapWith]] = [next[swapWith]!, next[here]!]
      // Keep `order` in sync with array position so groupForEditor (which
      // sorts by order) reflects the swap immediately, not just on Save.
      return next.map((w, i) => ({ ...w, order: i }))
    })
  }

  const handleReset = () => {
    setDraft([...DEFAULT_LAYOUT.widgets].sort((a, b) => a.order - b.order))
    setWidth(DEFAULT_CANVAS_WIDTH)
  }

  const handleSave = () => {
    // Reindex order from array position, then normalize (caps + eligibility).
    const reindexed = draft.map((w, i) => ({ ...w, order: i }))
    onSave(normalizeWidgets(reindexed), width)
  }

  return (
    <Dialog.Content className="modal-centered fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-surface p-6 shadow-xl focus:outline-none">
      <div className="mb-4 border-b border-hairline pb-4">
        <Dialog.Title className="text-[1.05em] font-semibold tracking-tight text-foreground">
          {t('dashboard.editWidgets.customizeTitle')}
        </Dialog.Title>
        <Dialog.Description className="mt-1 text-[0.86em] text-muted-foreground">
          {t('dashboard.editWidgets.customizeDescription')}
        </Dialog.Description>
      </div>

      <div className="mb-4 flex flex-col gap-3 border-b border-hairline pb-4">
        <Segmented
          label={t('dashboard.editWidgets.width.label')}
          hint={t(`dashboard.editWidgets.width.${width}Hint`)}
          options={CANVAS_WIDTHS}
          value={width}
          optionLabel={(v) => t(`dashboard.editWidgets.width.${v}`)}
          onChange={(next) => setWidth(next)}
        />
        <Segmented
          label={t('dashboard.editWidgets.groupBy.label')}
          options={GROUP_BY_OPTIONS}
          value={groupBy}
          optionLabel={(v) => t(`dashboard.editWidgets.groupBy.${v}`)}
          onChange={(next) => setGroupBy(next)}
        />
      </div>

      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
        {groupBy === 'placement'
          ? EDITOR_ZONES.map((zone) => {
              const rows =
                zone === 'top'
                  ? groups.top
                  : zone === 'under_workspace'
                    ? groups.under_workspace
                    : zone === 'under_quick_actions'
                      ? groups.under_quick_actions
                      : groups.hidden
              const cap = zone === 'top' ? MAX_TOP : zone === 'hidden' ? null : MAX_PER_LOWER_ZONE
              return (
                <Group
                  key={zone}
                  heading={t(`dashboard.editWidgets.zones.${zone}`)}
                  count={cap == null ? null : `${rows.length}/${cap}`}
                >
                  {rows.map((item, index) => (
                    <WidgetRow
                      key={item.id}
                      item={item}
                      zone={zone}
                      label={labels[item.id] ?? item.id}
                      counts={counts}
                      onZone={(z) => setZone(item.id, z)}
                      onMove={(dir) => move(item.id, dir)}
                      atStart={index === 0}
                      atEnd={index === rows.length - 1}
                    />
                  ))}
                </Group>
              )
            })
          : WIDGET_SOURCES.map((source) => (
              <Group
                key={source}
                heading={t(`dashboard.editWidgets.sources.${source}`)}
                count={null}
              >
                {bySource[source].map((item) => (
                  <WidgetRow
                    key={item.id}
                    item={item}
                    zone={editorZoneOf(item)}
                    label={labels[item.id] ?? item.id}
                    counts={counts}
                    onZone={(z) => setZone(item.id, z)}
                  />
                ))}
              </Group>
            ))}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-hairline pt-4">
        <button
          type="button"
          onClick={handleReset}
          className="text-[0.82em] font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:rounded-sm"
        >
          {t('dashboard.editWidgets.reset')}
        </button>
        <div className="flex items-center gap-2">
          <Dialog.Close asChild>
            <button type="button" className={OUTLINE_PILL}>
              {t('dashboard.editWidgets.cancel')}
            </button>
          </Dialog.Close>
          <button type="button" onClick={handleSave} disabled={isSaving} className={PRIMARY_PILL}>
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('dashboard.editWidgets.save')}
          </button>
        </div>
      </div>
    </Dialog.Content>
  )
}

/**
 * Two-or-three-way choice rendered as a pill group. A radio group, not a
 * `<select>`: both options are worth seeing at a glance, and the set never
 * grows past three.
 */
function Segmented<T extends string>({
  label,
  hint,
  options,
  value,
  optionLabel,
  onChange,
}: {
  label: string
  hint?: string
  options: readonly T[]
  value: T
  optionLabel: (option: T) => string
  onChange: (next: T) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="text-[0.78em] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex rounded-full border border-hairline bg-surface-tinted p-0.5"
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === value}
            onClick={() => onChange(option)}
            className={`rounded-full px-3 py-1 text-[0.8em] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              option === value
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {optionLabel(option)}
          </button>
        ))}
      </div>
      {hint != null && <span className="text-[0.78em] text-muted-foreground">{hint}</span>}
    </div>
  )
}

/** One heading + its rows, with an em-dash placeholder when the group is empty. */
function Group({
  heading,
  count,
  children,
}: {
  heading: string
  count: string | null
  children: React.ReactNode[]
}): React.JSX.Element {
  return (
    <section>
      <h4 className="mb-1.5 flex items-center gap-2 text-[0.78em] font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
        {count != null && <span className="font-mono text-[0.9em] font-normal">{count}</span>}
      </h4>
      {children.length === 0 ? (
        <p className="px-1 py-2 text-[0.8em] text-faint">—</p>
      ) : (
        <ul className="flex flex-col gap-1.5">{children}</ul>
      )}
    </section>
  )
}

/**
 * One widget row. `onMove` is omitted when the list is grouped by source,
 * because order is only meaningful inside a placement zone — offering arrows
 * that reorder some other list would be a lie.
 */
function WidgetRow({
  item,
  zone,
  label,
  counts,
  onZone,
  onMove,
  atStart,
  atEnd,
}: {
  item: DashboardWidgetConfig
  zone: EditorZone
  label: string
  counts: { top: number; under_workspace: number; under_quick_actions: number }
  onZone: (zone: EditorZone) => void
  onMove?: (dir: -1 | 1) => void
  atStart?: boolean
  atEnd?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <li className="flex items-center gap-2 rounded-lg border border-hairline bg-surface-raised px-3 py-2">
      <span className="flex-1 truncate text-[0.9em] font-medium text-foreground">{label}</span>
      {onMove && (
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={atStart}
            aria-label={t('dashboard.editWidgets.moveUp')}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronUp className="h-4 w-4" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={atEnd}
            aria-label={t('dashboard.editWidgets.moveDown')}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronDown className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
      )}
      <ZoneSelect
        id={item.id}
        current={zone}
        counts={counts}
        onChange={onZone}
        label={t('dashboard.editWidgets.zonePicker')}
        zoneLabel={(z) => t(`dashboard.editWidgets.zones.${z}`)}
        widgetLabel={label}
      />
    </li>
  )
}

function ZoneSelect({
  id,
  current,
  counts,
  onChange,
  label,
  zoneLabel,
  widgetLabel,
}: {
  id: string
  current: EditorZone
  counts: { top: number; under_workspace: number; under_quick_actions: number }
  onChange: (z: EditorZone) => void
  label: string
  zoneLabel: (z: EditorZone) => string
  widgetLabel: string
}): React.JSX.Element {
  const topEligible = TOP_ELIGIBLE_SET.has(id)
  const isDisabled = (z: EditorZone): boolean => {
    if (z === current) return false
    if (z === 'top') return !topEligible || counts.top >= MAX_TOP
    if (z === 'hidden') return false
    return counts[z] >= MAX_PER_LOWER_ZONE
  }
  return (
    <select
      aria-label={`${label}: ${widgetLabel}`}
      data-testid={`zone-select-${id}`}
      title={label}
      value={current}
      onChange={(e) => onChange(e.target.value as EditorZone)}
      className="rounded-md border border-hairline bg-surface px-2 py-1 text-[0.78em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {EDITOR_ZONES.map((z) => (
        <option key={z} value={z} disabled={isDisabled(z)}>
          {zoneLabel(z)}
        </option>
      ))}
    </select>
  )
}

// Re-export the canonical id list so consumers can build the label map.
export { WIDGET_IDS }
