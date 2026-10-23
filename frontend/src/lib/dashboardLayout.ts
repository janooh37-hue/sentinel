import type { DashboardLayout, DashboardQuickActionConfig, DashboardWidgetConfig } from './api'
import type { WidgetTier } from '@/pages/dashboard/widgets/types'

export type CanvasWidth = 'compact' | 'wide'
export const CANVAS_WIDTHS = ['compact', 'wide'] as const
export const DEFAULT_CANVAS_WIDTH: CanvasWidth = 'compact'
export const WIDGET_SIZES = ['S', 'M', 'L', 'W'] as const
export type WidgetSize = (typeof WIDGET_SIZES)[number]
export const WIDGET_IDS = [
  'waiting_approvals', 'pending', 'sent_approvals', 'inbox', 'ledger', 'workspace',
  'quick_actions', 'on_leave_today', 'upcoming_leave', 'drafts', 'expiring_soon',
  'violation_months', 'violations', 'pending_departures', 'workforce_pulse', 'permits',
] as const
export type WidgetId = (typeof WIDGET_IDS)[number]
export type WidgetSource = 'records' | 'approvals' | 'ledger' | 'employees' | 'leaves' | 'workforce' | 'permits' | 'services'
export const MAX_VISIBLE_QUICK_ACTIONS = 8
export const QUICK_ACTION_IDS = [
  'General Book', 'Acknowledgment Form', 'Salary Transfer Request', 'Leave Permit Form',
  'Violation Form', 'Leave Application Form', 'Duty Resumption Form', 'HR Request Form',
  'Salary Deduction Form', 'Employee Clearance Form', 'Passport Release Form',
  'Material Request Form', 'Resignation Letter', 'Administrative Leave Form',
  'Warning Form', 'Passport Release List', 'Report', 'Inmate Conduct Violations',
] as const
export type QuickActionId = (typeof QUICK_ACTION_IDS)[number]

export function hasServiceCap(id: string, has: (capability: string) => boolean): boolean {
  return has(`books.service.${id}`)
}
export function hasServiceRecordsCap(id: string, has: (capability: string) => boolean): boolean {
  return has(`books.servicerecords.${id}`)
}
export function isQuickActionAllowed(id: string, has: (capability: string) => boolean): boolean {
  return has('documents.generate') && has('books.view') && hasServiceCap(id, has)
}
export function mergeQuickActionsPreservingDenied(
  original: readonly DashboardQuickActionConfig[],
  editedAllowed: readonly DashboardQuickActionConfig[],
): DashboardQuickActionConfig[] {
  const allowedIds = new Set(editedAllowed.map((item) => item.id))
  let editedIndex = 0
  return original.map((item, order) => {
    if (!allowedIds.has(item.id)) return { ...item, order }
    return { ...(editedAllowed[editedIndex++] ?? item), order }
  })
}

const DEFAULT_SIZES: Record<WidgetId, WidgetSize> = {
  waiting_approvals: 'L', pending: 'M', sent_approvals: 'S', inbox: 'S', ledger: 'M',
  workspace: 'M', quick_actions: 'W', on_leave_today: 'L', upcoming_leave: 'S',
  drafts: 'S', expiring_soon: 'S', violation_months: 'S', violations: 'S',
  pending_departures: 'L', workforce_pulse: 'M', permits: 'L',
}
export const DEFAULT_LAYOUT: DashboardLayout = {
  widgets: WIDGET_IDS.map((id, order) => ({ id, visible: order < 12, order, size: DEFAULT_SIZES[id] })),
  quick_actions: QUICK_ACTION_IDS.map((id, order) => ({ id, visible: order < 4, order })),
  canvas_width: DEFAULT_CANVAS_WIDTH,
}

const WIDGET_ID_LOOKUP: Record<string, true> = Object.fromEntries(WIDGET_IDS.map((id) => [id, true]))
const QUICK_ACTION_ID_LOOKUP: Record<string, true> = Object.fromEntries(QUICK_ACTION_IDS.map((id) => [id, true]))
const LEGACY_PANELS: Record<string, true> = {
  waiting_approvals: true, expiring_soon: true, on_leave_today: true, upcoming_leave: true,
  pending_departures: true, workforce_pulse: true, violation_months: true, permits: true,
}
type SavedWidget = { id: string; visible: boolean; order: number; size?: string; zone?: string | null }
type SavedLayout = { widgets?: SavedWidget[]; quick_actions?: { id: string; visible: boolean; order: number }[]; canvas_width?: string | null }

/** Read old zones once; all output (including API writes) is size-based. */
export function resolveLayout(saved: SavedLayout | null | undefined): DashboardLayout {
  if (!saved) return DEFAULT_LAYOUT
  const seen = new Set<string>()
  const raw = [...(saved.widgets ?? [])].sort((a, b) => a.order - b.order)
  const legacy = raw.some((item) => !item.size || item.zone != null)
  // Zone order was visual order, even when stored orders interleaved zones.
  if (legacy) raw.sort((a, b) => {
    const rank = (w: SavedWidget) => w.zone === 'top' || (!w.zone && ['pending', 'workspace'].includes(w.id)) ? 0 : w.zone === 'under_quick_actions' ? 2 : 1
    return rank(a) - rank(b) || a.order - b.order
  })
  const kept: DashboardWidgetConfig[] = []
  let bandAfter = 0
  for (const item of raw) {
    if (WIDGET_ID_LOOKUP[item.id] !== true || seen.has(item.id)) continue
    seen.add(item.id)
    const id = item.id as WidgetId
    const size = WIDGET_SIZES.includes(item.size as WidgetSize) ? item.size as WidgetSize
      : item.zone === 'top' || (!item.zone && ['pending', 'workspace'].includes(id)) ? 'M'
      : LEGACY_PANELS[id] === true ? 'L' : 'S'
    kept.push({ id, visible: item.visible, order: kept.length, size })
    if (item.zone !== 'under_quick_actions') bandAfter = kept.length
  }
  if (legacy && !seen.has('quick_actions')) {
    kept.splice(bandAfter, 0, { id: 'quick_actions', visible: true, size: 'W', order: bandAfter })
    seen.add('quick_actions')
  }
  for (const id of WIDGET_IDS) {
    if (!seen.has(id)) kept.push({ id, visible: false, order: kept.length, size: DEFAULT_SIZES[id] })
  }
  const actionSeen = new Set<string>()
  const quick_actions: DashboardQuickActionConfig[] = []
  for (const item of [...(saved.quick_actions ?? [])].sort((a, b) => a.order - b.order)) {
    if (QUICK_ACTION_ID_LOOKUP[item.id] !== true || actionSeen.has(item.id)) continue
    actionSeen.add(item.id)
    quick_actions.push({ id: item.id as QuickActionId, visible: item.visible, order: quick_actions.length })
  }
  for (const id of QUICK_ACTION_IDS) {
    if (!actionSeen.has(id)) quick_actions.push({ id, visible: false, order: quick_actions.length })
  }
  return { widgets: widgetsForApi(kept), quick_actions, canvas_width: resolveCanvasWidth(saved.canvas_width) }
}
export function resolveCanvasWidth(saved: string | null | undefined): CanvasWidth {
  return saved === 'wide' ? 'wide' : DEFAULT_CANVAS_WIDTH
}
export function widgetsForApi(widgets: readonly DashboardWidgetConfig[]): DashboardWidgetConfig[] {
  return widgets.map(({ id, visible, size }, order) => ({ id, visible, size, order }))
}

export interface PackedWidget { id: string; size: WidgetSize; r: number; c: number; w: number; h: number; grown: boolean }
export interface PackedLayout { placed: PackedWidget[]; holes: [number, number][]; cols: number }

/** Logical columns: CSS grid mirrors inline-start in RTL without changing placement. */
export function packLayout(items: readonly { id: string; size: WidgetSize }[], cols: number): PackedLayout {
  if (!Number.isInteger(cols) || cols < 1) throw new RangeError('Grid columns must be a positive integer')
  const grid: (PackedWidget | undefined)[][] = []
  const free = (r: number, c: number, w: number, h: number) => {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) {
      if (x >= cols || grid[y]?.[x]) return false
    }
    return true
  }
  const mark = (item: PackedWidget) => {
    for (let y = item.r; y < item.r + item.h; y++) {
      grid[y] ??= []
      for (let x = item.c; x < item.c + item.w; x++) grid[y]![x] = item
    }
  }
  const placed: PackedWidget[] = []
  for (const { id, size } of items) {
    const w = size === 'W' ? cols : Math.min(size === 'S' ? 1 : 2, cols)
    const h = size === 'L' || (cols === 2 && size === 'W') ? 2 : 1
    let done = false
    for (let r = 0; !done; r++) for (let c = 0; c <= cols - w && !done; c++) {
      if (free(r, c, w, h)) {
        const item = { id, size, r, c, w, h, grown: false }
        mark(item)
        placed.push(item)
        done = true
      }
    }
  }
  const rowsUsed = Math.max(0, ...placed.map((p) => p.r + p.h))
  const holes = (): [number, number][] => {
    const result: [number, number][] = []
    for (let r = 0; r < rowsUsed; r++) for (let c = 0; c < cols; c++) if (!grid[r]?.[c]) result.push([r, c])
    return result
  }
  // Each successful pass consumes at least one hole, so termination needs no arbitrary guard.
  let changed = true
  while (changed) {
    changed = false
    for (const [r, c] of holes()) {
      if (grid[r]?.[c]) continue
      const start = grid[r]?.[c - 1]
      const end = grid[r]?.[c + 1]
      const above = grid[r - 1]?.[c]
      if (start && start.c + start.w === c && start.r === r && free(r, c, 1, start.h)) {
        start.w++
        start.grown = true
        mark(start)
      } else if (end && end.c === c + 1 && end.r === r && free(r, c, 1, end.h)) {
        end.c--
        end.w++
        end.grown = true
        mark(end)
      } else if (above && above.r + above.h === r && free(r, above.c, above.w, 1)) {
        above.h++
        above.grown = true
        mark(above)
      } else continue
      changed = true
    }
  }
  return { placed, holes: holes(), cols }
}
export function tierOf(w: number, h: number): WidgetTier {
  return h >= 2 ? w >= 2 ? 'list' : 'tall' : w >= 2 ? 'summary' : 'glance'
}
export function rowsPerHeight(h: number): number {
  return h < 2 ? 0 : h >= 3 ? 7 : 4
}
