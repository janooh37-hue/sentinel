import { describe, expect, it } from 'vitest'

import type { DashboardLayout } from './api'
import {
  DEFAULT_LAYOUT,
  QUICK_ACTION_IDS,
  TOP_ELIGIBLE_SET,
  WIDGET_IDS,
  WIDGET_SOURCE,
  WIDGET_SOURCES,
  resolveLayout,
  isQuickActionAllowed,
  hasServiceCap,
  mergeQuickActionsPreservingDenied,
  type QuickActionId,
} from './dashboardLayout'

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

describe('pending_departures widget is hidden by default', () => {
  it('is present but not visible in DEFAULT_LAYOUT', () => {
    const widget = DEFAULT_LAYOUT.widgets.find((w) => w.id === 'pending_departures')
    expect(widget).toMatchObject({ visible: false, zone: 'under_workspace' })
  })

  it('resolveLayout appends it hidden for a saved layout that never mentioned it', () => {
    const saved = {
      widgets: [{ id: 'pending', visible: true, order: 0, zone: 'top' }],
      quick_actions: [],
    } as unknown as DashboardLayout

    const resolved = resolveLayout(saved)
    const widget = resolved.widgets.find((w) => w.id === 'pending_departures')
    expect(widget).toMatchObject({ visible: false })
  })
})

describe('workforce_pulse widget is hidden by default', () => {
  it('is appended to saved layouts that never mentioned it in a lower zone', () => {
    const saved = {
      widgets: [{ id: 'pending', visible: true, order: 0, zone: 'top' }],
      quick_actions: [],
    } as unknown as DashboardLayout

    const resolved = resolveLayout(saved)

    expect(resolved.widgets.find((w) => w.id === 'workforce_pulse')).toMatchObject({
      visible: false,
      zone: 'under_workspace',
    })
  })

  it('is filed under Workforce and cannot occupy the top zone', () => {
    expect(WIDGET_SOURCE.workforce_pulse).toBe('workforce')
    expect(TOP_ELIGIBLE_SET.has('workforce_pulse')).toBe(false)
  })
})

describe('canvas width', () => {
  it('defaults to the compact 1180px column', () => {
    expect(DEFAULT_LAYOUT.canvas_width).toBe('compact')
  })

  it('keeps a layout saved before the field existed on compact', () => {
    const saved = { widgets: [], quick_actions: [] } as unknown as DashboardLayout
    expect(resolveLayout(saved).canvas_width).toBe('compact')
  })

  it('preserves an explicit wide canvas and rejects anything else', () => {
    const of = (canvas_width: string): string | undefined =>
      resolveLayout({ widgets: [], quick_actions: [], canvas_width } as unknown as DashboardLayout)
        .canvas_width
    expect(of('wide')).toBe('wide')
    expect(of('full-bleed')).toBe('compact')
  })
})

describe('widget source map', () => {
  // The editor's source view renders `WIDGET_SOURCES` groups only, so a widget
  // missing from the map — or filed under a group nobody renders — silently
  // disappears from that view.
  it('files every widget under a rendered source', () => {
    for (const id of WIDGET_IDS) {
      expect(WIDGET_SOURCES).toContain(WIDGET_SOURCE[id])
    }
  })
})
