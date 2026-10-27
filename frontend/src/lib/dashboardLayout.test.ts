import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT, QUICK_ACTION_IDS, WIDGET_IDS, WIDGET_SIZES, packLayout, tierOf, rowsPerHeight, resolveLayout, widgetsForApi, isQuickActionAllowed, hasServiceCap, hasServiceRecordsCap, mergeQuickActionsPreservingDenied, type PackedWidget, type QuickActionId, type WidgetSize } from './dashboardLayout'
import type { DashboardLayout } from './api'

describe('companion quick-actions are gone', () => {
  it('QUICK_ACTION_IDS excludes companion forms', () => {
    expect(QUICK_ACTION_IDS).not.toContain('Leave Undertaking')
    expect(QUICK_ACTION_IDS).not.toContain('Resignation Declaration')
  })

  it('resolveLayout drops a stale companion quick-action from a saved layout', () => {
    const saved = {
      widgets: [],
      quick_actions: [
        { id: 'Leave Undertaking', visible: true, order: 0 },
        { id: 'Leave Application Form', visible: true, order: 1 },
      ],
    } as unknown as DashboardLayout

    const resolved = resolveLayout(saved)
    const ids = resolved.quick_actions.map((q) => q.id)
    expect(ids).not.toContain('Leave Undertaking')
    expect(ids).toContain('Leave Application Form')
  })
})

describe('dynamic service capabilities', () => {
  it('requires both creation page capabilities and the selected service capability', () => {
    const allowed = new Set([
      'documents.generate',
      'books.view',
      'books.service.Report',
    ])
    const has = (capability: string): boolean => allowed.has(capability)

    expect(isQuickActionAllowed('Report', has)).toBe(true)

    allowed.delete('documents.generate')
    expect(isQuickActionAllowed('Report', has)).toBe(false)

    allowed.add('documents.generate')
    allowed.delete('books.view')
    expect(isQuickActionAllowed('Report', has)).toBe(false)

    allowed.add('books.view')
    allowed.delete('books.service.Report')
    expect(isQuickActionAllowed('Report', has)).toBe(false)
  })

  it('checks bare service visibility independently from creation capabilities', () => {
    const checked: string[] = []
    const has = (capability: string): boolean => {
      checked.push(capability)
      return capability === 'books.service.Report'
    }

    expect(hasServiceCap('Report', has)).toBe(true)
    expect(hasServiceCap('General Book', has)).toBe(false)
    expect(checked).toEqual([
      'books.service.Report',
      'books.service.General Book',
    ])
  })

  it('checks the exact records capability independently from creation access', () => {
    const checked: string[] = []
    const has = (capability: string): boolean => {
      checked.push(capability)
      return (
        capability === 'books.servicerecords.General Book' ||
        capability === 'books.service.Report'
      )
    }

    expect(hasServiceRecordsCap('General Book', has)).toBe(true)
    expect(hasServiceRecordsCap('Report', has)).toBe(false)
    expect(checked).toEqual([
      'books.servicerecords.General Book',
      'books.servicerecords.Report',
    ])
  })
})

describe('permission-filtered quick-action saves', () => {
  it('keeps denied entries in their original positions while applying allowed order', () => {
    const original: Array<{ id: QuickActionId; visible: boolean; order: number }> = [
      { id: 'General Book', visible: true, order: 0 },
      { id: 'Report', visible: true, order: 1 },
      { id: 'Violation Form', visible: true, order: 2 },
    ]
    const editedAllowed: Array<{ id: QuickActionId; visible: boolean; order: number }> = [
      { id: 'Violation Form', visible: true, order: 0 },
      { id: 'General Book', visible: false, order: 1 },
    ]

    expect(mergeQuickActionsPreservingDenied(original, editedAllowed)).toEqual([
      { id: 'Violation Form', visible: true, order: 0 },
      { id: 'Report', visible: true, order: 1 },
      { id: 'General Book', visible: false, order: 2 },
    ])
  })
})


describe('size-based layouts', () => {
  it('uses the approved HR-admin order and sizes, keeping other widgets hidden', () => {
    expect(DEFAULT_LAYOUT.widgets.filter((item) => item.visible).map(({ id, size }) => [id, size])).toEqual([
      ['waiting_approvals', 'L'], ['pending', 'M'], ['sent_approvals', 'S'], ['inbox', 'S'],
      ['ledger', 'M'], ['workspace', 'M'], ['quick_actions', 'W'], ['on_leave_today', 'L'],
      ['upcoming_leave', 'S'], ['drafts', 'S'], ['expiring_soon', 'S'], ['violation_months', 'S'],
    ])
    expect(DEFAULT_LAYOUT.canvas_width).toBe('compact')
  })
  it('migrates visual zone order, preserves visibility, and inserts the former actions band', () => {
    const layout = resolveLayout({ widgets: [
      { id: 'drafts', visible: false, order: 0, zone: 'under_workspace' },
      { id: 'pending', visible: true, order: 1, zone: 'top' },
      { id: 'permits', visible: true, order: 2, zone: 'under_quick_actions' },
      { id: 'on_leave_today', visible: true, order: 3, zone: 'under_workspace' },
      { id: 'email_sync_status', visible: true, order: 4, zone: 'under_workspace' },
      { id: 'unknown', visible: true, order: 5 },
    ], quick_actions: [], canvas_width: 'wide' })
    expect(layout.widgets.slice(0, 5)).toEqual([
      { id: 'pending', visible: true, order: 0, size: 'M' },
      { id: 'drafts', visible: false, order: 1, size: 'S' },
      { id: 'on_leave_today', visible: true, order: 2, size: 'L' },
      { id: 'quick_actions', visible: true, order: 3, size: 'W' },
      { id: 'permits', visible: true, order: 4, size: 'XL' },
    ])
    expect(layout.widgets).toHaveLength(WIDGET_IDS.length)
    expect(layout.widgets.find((item) => item.id === 'violations')?.visible).toBe(false)
    expect(layout.canvas_width).toBe('wide')
    expect(layout.widgets.every((item) => !('zone' in item))).toBe(true)
  })
  it('recognizes server-migrated sizes while a legacy zone is still present', () => {
    const layout = resolveLayout({ widgets: [{ id: 'pending', visible: true, order: 0, size: 'M', zone: 'top' }], quick_actions: [] })
    expect(layout.widgets.slice(0, 2).map((item) => item.id)).toEqual(['pending', 'quick_actions'])
    expect(layout.widgets[1]).toMatchObject({ visible: true, size: 'W' })
  })
  it('keeps a pre-zone visible set, drops retired ids and deduplicates', () => {
    const layout = resolveLayout({ widgets: [
      { id: 'pending', visible: false, order: 0 },
      { id: 'waiting_approvals', visible: true, order: 1 },
      { id: 'waiting_approvals', visible: false, order: 2 },
      { id: 'recent_docs', visible: true, order: 3 },
      { id: 'recent_ledger', visible: true, order: 4 },
    ], quick_actions: [], canvas_width: 'invalid' })
    expect(layout.widgets.filter((item) => item.visible).map((item) => item.id)).toEqual(['waiting_approvals', 'quick_actions'])
    expect(layout.widgets[0]).toMatchObject({ id: 'pending', visible: false, size: 'M' })
    expect(layout.canvas_width).toBe('compact')
  })
  it('restores the actions band from the empty or fully pruned legacy GET response', () => {
    // GET /dashboard/layout emits this same shape for empty, all-retired and all-unknown layouts.
    const layout = resolveLayout({
      widgets: [],
      quick_actions: [
        { id: 'Report', visible: true, order: 0 },
        { id: 'General Book', visible: false, order: 1 },
      ],
      canvas_width: 'wide',
    })
    expect(layout.widgets.filter((item) => item.visible)).toEqual([
      { id: 'quick_actions', visible: true, size: 'W', order: 0 },
    ])
    expect(layout.widgets).toHaveLength(WIDGET_IDS.length)
    expect(layout.quick_actions.slice(0, 2)).toEqual([
      { id: 'Report', visible: true, order: 0 },
      { id: 'General Book', visible: false, order: 1 },
    ])
    expect(layout.quick_actions.filter((item) => item.visible).map((item) => item.id)).toEqual(['Report'])
    expect(layout.canvas_width).toBe('wide')
  })
  it('keeps explicitly hidden v2 actions hidden after other widgets are pruned on read', () => {
    const layout = resolveLayout({
      widgets: [{ id: 'quick_actions', visible: false, order: 1, size: 'W' }],
      quick_actions: [
        { id: 'Report', visible: true, order: 0 },
        { id: 'General Book', visible: false, order: 1 },
      ],
      canvas_width: 'wide',
    })
    expect(layout.widgets.filter((item) => item.visible)).toEqual([])
    expect(layout.widgets[0]).toEqual({ id: 'quick_actions', visible: false, order: 0, size: 'W' })
    expect(layout.quick_actions.slice(0, 2)).toEqual([
      { id: 'Report', visible: true, order: 0 },
      { id: 'General Book', visible: false, order: 1 },
    ])
  })
  it('round-trips a size layout without adding actions or enforcing old slot limits', () => {
    const saved = { ...DEFAULT_LAYOUT, widgets: DEFAULT_LAYOUT.widgets.map((item) => ({ ...item, visible: item.id !== 'quick_actions' })) }
    expect(resolveLayout(saved)).toEqual(saved)
    expect(widgetsForApi(saved.widgets).every((item) => !('zone' in item))).toBe(true)
  })
})

function assertPacking(items: { id: string; size: WidgetSize }[], cols: number) {
  const { placed, holes } = packLayout(items, cols)
  expect(placed.map((item) => item.id)).toEqual(items.map((item) => item.id))
  const occupied = new Map<string, PackedWidget>()
  for (const box of placed) {
    expect(box.c).toBeGreaterThanOrEqual(0)
    expect(box.c + box.w).toBeLessThanOrEqual(cols)
    for (let r = box.r; r < box.r + box.h; r++) for (let c = box.c; c < box.c + box.w; c++) {
      const key = [r, c].join(',')
      expect(occupied.has(key)).toBe(false)
      occupied.set(key, box)
    }
  }
  for (const [r, c] of holes) {
    const start = occupied.get([r, c - 1].join(','))
    const end = occupied.get([r, c + 1].join(','))
    const above = occupied.get([r - 1, c].join(','))
    for (const neighbour of [start, end]) {
      if (neighbour?.r !== r) continue
      const canGrow = Array.from({ length: neighbour.h }, (_, k) => !occupied.has([r + k, c].join(','))).every(Boolean)
      expect(canGrow).toBe(false)
    }
    if (above && above.r + above.h === r) {
      expect(Array.from({ length: above.w }, (_, k) => !occupied.has([r, above.c + k].join(','))).every(Boolean)).toBe(false)
    }
  }
  return { placed, holes }
}

describe('dense packing with automatic gap filling', () => {
  it.each([2, 4, 6])('leaves zero holes in the approved default at %i columns', (cols) => {
    const items = DEFAULT_LAYOUT.widgets.filter((item) => item.visible)
    expect(assertPacking(items, cols).holes).toEqual([])
  })
  it('places every input once, without overlaps, and exhausts all neighbour growth', () => {
    for (const cols of [2, 4, 6]) for (let seed = 1; seed <= 60; seed++) {
      let state = seed
      const items = Array.from({ length: 1 + seed % 16 }, (_, index) => {
        state = (state * 1664525 + 1013904223) >>> 0
        return { id: String(index), size: WIDGET_SIZES[(state >>> 16) % WIDGET_SIZES.length]! }
      })
      assertPacking(items, cols)
    }
  })
  it('does not mutate inputs and uses logical, direction-independent columns', () => {
    const items = [{ id: 'a', size: 'L' }, { id: 'b', size: 'S' }] as const
    const before = structuredClone(items)
    const packed = packLayout(items, 4)
    expect(items).toEqual(before)
    expect(packed.placed[0]).toMatchObject({ c: 0, r: 0 })
    expect(packed.placed[1]?.c).toBeGreaterThan(0)
    expect(packLayout(items, 4)).toEqual(packed)
  })
  it('gives phone-wide strips two rows and handles the empty grid', () => {
    expect(packLayout([{ id: 'actions', size: 'W' }], 2).placed[0]).toMatchObject({ w: 2, h: 2 })
    expect(packLayout([], 4)).toEqual({ placed: [], holes: [], cols: 4 })
    expect(() => packLayout([], 0)).toThrow(RangeError)
  })
  it('spans extra-large widgets across the canvas for three list rows', () => {
    for (const cols of [2, 4, 6]) {
      const { placed } = assertPacking([{ id: 'a', size: 'S' }, { id: 'permits', size: 'XL' }, { id: 'b', size: 'S' }], cols)
      expect(placed[1]).toMatchObject({ c: 0, r: 1, w: cols, h: 3 })
      expect(tierOf(placed[1]!.w, placed[1]!.h)).toBe('list')
      expect(rowsPerHeight(placed[1]!.h)).toBe(7)
    }
  })
  it('derives content tiers and list row limits from final boxes', () => {
    expect([tierOf(1, 1), tierOf(2, 1), tierOf(1, 2), tierOf(2, 2)]).toEqual(['glance', 'summary', 'tall', 'list'])
    expect([1, 2, 3, 4].map(rowsPerHeight)).toEqual([0, 4, 7, 7])
  })
})
