import { describe, expect, it } from 'vitest'

import type { DashboardLayout } from './api'
import {
  DEFAULT_LAYOUT,
  QUICK_ACTION_IDS,
  WIDGET_IDS,
  WIDGET_SOURCE,
  WIDGET_SOURCES,
  resolveLayout,
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
