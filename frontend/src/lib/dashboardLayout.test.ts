import { describe, expect, it } from 'vitest'

import type { DashboardLayout } from './api'
import { DEFAULT_LAYOUT, QUICK_ACTION_IDS, resolveLayout } from './dashboardLayout'

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
