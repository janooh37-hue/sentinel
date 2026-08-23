/**
 * Dashboard layout — zoned widget model.
 *
 * Each widget config carries `{ id, visible, order, zone }`. Zones:
 *   • top                 — exactly 2 big-card slots (only TOP_ELIGIBLE ids).
 *   • under_workspace     — grid below the top pair.
 *   • under_quick_actions — grid below the quick-action tiles.
 * Hidden = `visible: false` (zone is remembered so re-showing restores place).
 *
 * The backend stores `AppSettings.dashboard_layout` as nullable JSON; this
 * module is the canonical catalog + resolver. Legacy (zone-less) layouts are
 * migrated by `resolveLayout`: pending/workspace → top, previously-visible
 * widgets → under_workspace, never-seen ids appended hidden.
 */

import type {
  DashboardLayout,
  DashboardQuickActionConfig,
  DashboardWidgetConfig,
} from './api'

export type WidgetZone = 'top' | 'under_workspace' | 'under_quick_actions'
export type WidgetSize = 'metric' | 'panel'

/**
 * Page measure. `compact` is the 1180px column every other page uses; `wide`
 * lets the grid span the window. Compact is the default — it is the incumbent
 * look, and a layout saved before the field existed must not change width.
 */
export type CanvasWidth = 'compact' | 'wide'
export const CANVAS_WIDTHS = ['compact', 'wide'] as const
export const DEFAULT_CANVAS_WIDTH: CanvasWidth = 'compact'

/**
 * Destination each widget reports on, so the editor groups by origin
 * ("which page does it come from?") instead of only by placement.
 */
export type WidgetSource = 'employees' | 'leaves' | 'records'
export const WIDGET_SOURCES = ['employees', 'leaves', 'records'] as const

/** Canonical widget ids (order = catalog order in the editor). */
export const WIDGET_IDS = [
  'pending',
  'workspace',
  'waiting_approvals',
  'violations',
  'expiring_soon',
  'on_leave_today',
  'upcoming_leave',
  'recent_docs',
  'pending_departures',
] as const

export type WidgetId = (typeof WIDGET_IDS)[number]

/** Only these may occupy a Top slot (rendered as big cards). */
export const TOP_ELIGIBLE_IDS = ['pending', 'workspace', 'waiting_approvals'] as const
export const TOP_ELIGIBLE_SET = new Set<string>(TOP_ELIGIBLE_IDS)

/** Grid sizing: metric = 1 column, panel = full row. */
export const WIDGET_SIZE: Record<WidgetId, WidgetSize> = {
  pending: 'metric',
  workspace: 'metric',
  waiting_approvals: 'panel',
  violations: 'metric',
  expiring_soon: 'panel',
  on_leave_today: 'panel',
  upcoming_leave: 'panel',
  recent_docs: 'panel',
  pending_departures: 'panel',
}

export const WIDGET_SOURCE: Record<WidgetId, WidgetSource> = {
  pending: 'records',
  workspace: 'employees',
  waiting_approvals: 'records',
  violations: 'employees',
  expiring_soon: 'employees',
  on_leave_today: 'leaves',
  upcoming_leave: 'leaves',
  recent_docs: 'employees',
  pending_departures: 'employees',
}

export const LOWER_ZONES = ['under_workspace', 'under_quick_actions'] as const
export const MAX_TOP = 2
export const MAX_PER_LOWER_ZONE = 6

/** Max quick-action tiles visible (unchanged — tiles keep their own editor). */
export const MAX_VISIBLE_QUICK_ACTIONS = 8

/**
 * Mirror of the backend `DashboardQuickActionId` Literal — keep in sync.
 *
 * Services only: one id per selectable form template, ordered most-used
 * first because `DEFAULT_LAYOUT` makes the leading four visible.
 */
export const QUICK_ACTION_IDS = [
  'General Book',
  'Acknowledgment Form',
  'Salary Transfer Request',
  'Leave Permit Form',
  'Violation Form',
  'Leave Application Form',
  'Duty Resumption Form',
  'HR Request Form',
  'Salary Deduction Form',
  'Employee Clearance Form',
  'Passport Release Form',
  'Material Request Form',
  'Resignation Letter',
  'Administrative Leave Form',
  'Warning Form',
  'Passport Release List',
  'Report',
  'Inmate Conduct Violations',
] as const

export type QuickActionId = (typeof QUICK_ACTION_IDS)[number]

const WIDGET_ID_SET = new Set<string>(WIDGET_IDS)
const QUICK_ACTION_ID_SET = new Set<string>(QUICK_ACTION_IDS)

/** Working widget shape with a guaranteed zone. */
type Widget = DashboardWidgetConfig & { zone: WidgetZone }

function zoneOf(w: DashboardWidgetConfig): WidgetZone {
  const z = (w as Widget).zone
  return z === 'top' || z === 'under_workspace' || z === 'under_quick_actions'
    ? z
    : 'under_workspace'
}

/**
 * Canonical "no saved layout" default:
 *   • Top: pending + workspace (visible).
 *   • Under Workspace: no mailbox widgets; remaining widgets are hidden until
 *     the operator opts in via the editor.
 *   • Quick actions: the first 4 service tiles visible.
 *   • Canvas: compact (1180px), the incumbent measure.
 */
export const DEFAULT_LAYOUT: DashboardLayout = {
  widgets: WIDGET_IDS.map((id, order) => {
    if (id === 'pending' || id === 'workspace') {
      return { id, visible: true, order, zone: 'top' as WidgetZone }
    }
    if (id === 'waiting_approvals') {
      return { id, visible: false, order, zone: 'top' as WidgetZone }
    }
    const visible = id === 'violations'
    return { id, visible, order, zone: 'under_workspace' as WidgetZone }
  }) as DashboardWidgetConfig[],
  quick_actions: QUICK_ACTION_IDS.map((id, order) => ({
    id,
    visible: order < 4,
    order,
  })),
  canvas_width: DEFAULT_CANVAS_WIDTH,
}

/**
 * Resolve a saved layout into a renderable, normalized one. Drops unknown ids,
 * migrates legacy entries into zones, appends never-seen ids hidden, then
 * clamps zone caps + top-eligibility.
 */
export function resolveLayout(saved: DashboardLayout | null | undefined): DashboardLayout {
  if (!saved) return DEFAULT_LAYOUT

  const seen = new Set<string>()
  const kept: Widget[] = []

  for (const raw of saved.widgets ?? []) {
    if (!WIDGET_ID_SET.has(raw.id)) continue
    if (seen.has(raw.id)) continue
    seen.add(raw.id)

    // Legacy migration: a saved entry with no `zone` predates the rework.
    const hasZone = 'zone' in raw && (raw as Widget).zone != null
    let zone: WidgetZone
    let visible = raw.visible
    if (hasZone) {
      zone = zoneOf(raw)
    } else if (raw.id === 'pending' || raw.id === 'workspace') {
      zone = 'top'
      visible = true // top pair was always visible (locked) pre-rework
    } else {
      zone = 'under_workspace'
    }
    kept.push({ id: raw.id, visible, order: raw.order, zone })
  }

  kept.sort((a, b) => a.order - b.order)

  // Append any canonical id the saved layout never mentioned — hidden, in its
  // default zone, so nobody's dashboard suddenly grows.
  let next = kept.length ? Math.max(...kept.map((x) => x.order)) + 1 : 0
  for (const id of WIDGET_IDS) {
    if (seen.has(id)) continue
    const zone: WidgetZone =
      id === 'pending' || id === 'workspace' || id === 'waiting_approvals'
        ? 'top'
        : 'under_workspace'
    kept.push({ id, visible: false, order: next, zone })
    next += 1
  }

  const widgets = normalizeWidgets(kept as DashboardWidgetConfig[])

  const quick_actions = mergeQuickActions(saved.quick_actions ?? [])
  return { widgets, quick_actions, canvas_width: resolveCanvasWidth(saved.canvas_width) }
}

/** Keep an unknown or absent measure on the incumbent compact column. */
export function resolveCanvasWidth(saved: string | null | undefined): CanvasWidth {
  return saved === 'wide' ? 'wide' : DEFAULT_CANVAS_WIDTH
}

function mergeQuickActions(
  saved: DashboardQuickActionConfig[],
): DashboardQuickActionConfig[] {
  const seen = new Set<string>()
  const kept: DashboardQuickActionConfig[] = []
  for (const item of saved) {
    if (!QUICK_ACTION_ID_SET.has(item.id)) continue
    if (seen.has(item.id)) continue
    seen.add(item.id)
    kept.push(item)
  }
  kept.sort((a, b) => a.order - b.order)
  let next = kept.length ? Math.max(...kept.map((x) => x.order)) + 1 : 0
  for (const id of QUICK_ACTION_IDS) {
    if (seen.has(id)) continue
    kept.push({ id, visible: false, order: next })
    next += 1
  }
  return kept
}

/**
 * Enforce structural rules and reindex `order` globally:
 *   • Top zone holds at most MAX_TOP visible, top-eligible widgets. A
 *     non-eligible widget in `top` is moved to `under_workspace`. Overflow
 *     past MAX_TOP is moved to `under_workspace` (kept visible).
 *   • Each lower zone holds at most MAX_PER_LOWER_ZONE visible widgets;
 *     overflow is flipped to `visible: false`.
 * Operates in the widgets' current array order (which encodes within-zone
 * ordering), then rewrites `order` to the array index.
 */
export function normalizeWidgets(
  input: DashboardWidgetConfig[],
): DashboardWidgetConfig[] {
  const widgets: Widget[] = input.map((w) => ({ ...w, zone: zoneOf(w) }))

  let topCount = 0
  const lowerCount: Record<string, number> = {
    under_workspace: 0,
    under_quick_actions: 0,
  }

  for (const w of widgets) {
    if (w.zone === 'top') {
      // Non-eligible OR overflow → demote to under_workspace (still visible).
      if (!TOP_ELIGIBLE_SET.has(w.id) || (w.visible && topCount >= MAX_TOP)) {
        w.zone = 'under_workspace'
      } else if (w.visible) {
        topCount += 1
      }
    }
    if (w.zone !== 'top' && w.visible) {
      if (lowerCount[w.zone]! >= MAX_PER_LOWER_ZONE) {
        w.visible = false
      } else {
        lowerCount[w.zone]! += 1
      }
    }
  }

  return widgets.map((w, i) => ({
    id: w.id,
    visible: w.visible,
    order: i,
    zone: w.zone,
  })) as DashboardWidgetConfig[]
}

/** Visible widgets bucketed by zone, sorted by order, capped per zone. */
export function visibleByZone(
  widgets: DashboardWidgetConfig[],
): Record<WidgetZone, DashboardWidgetConfig[]> {
  const out: Record<WidgetZone, DashboardWidgetConfig[]> = {
    top: [],
    under_workspace: [],
    under_quick_actions: [],
  }
  for (const w of [...widgets].sort((a, b) => a.order - b.order)) {
    if (!w.visible) continue
    out[zoneOf(w)].push(w)
  }
  out.top = out.top.slice(0, MAX_TOP)
  out.under_workspace = out.under_workspace.slice(0, MAX_PER_LOWER_ZONE)
  out.under_quick_actions = out.under_quick_actions.slice(0, MAX_PER_LOWER_ZONE)
  return out
}

/** Group ALL widgets for the editor: visible→its zone, hidden→`hidden`. */
export function groupForEditor(widgets: DashboardWidgetConfig[]): {
  top: DashboardWidgetConfig[]
  under_workspace: DashboardWidgetConfig[]
  under_quick_actions: DashboardWidgetConfig[]
  hidden: DashboardWidgetConfig[]
} {
  const out = {
    top: [] as DashboardWidgetConfig[],
    under_workspace: [] as DashboardWidgetConfig[],
    under_quick_actions: [] as DashboardWidgetConfig[],
    hidden: [] as DashboardWidgetConfig[],
  }
  for (const w of [...widgets].sort((a, b) => a.order - b.order)) {
    if (!w.visible) out.hidden.push(w)
    else out[zoneOf(w)].push(w)
  }
  return out
}

/** Structural pass-through to the API widget-config type (now incl. zone). */
export function widgetsForApi(
  widgets: DashboardWidgetConfig[],
): DashboardWidgetConfig[] {
  return widgets.map((w) => ({
    id: w.id,
    visible: w.visible,
    order: w.order,
    zone: zoneOf(w),
  })) as DashboardWidgetConfig[]
}
