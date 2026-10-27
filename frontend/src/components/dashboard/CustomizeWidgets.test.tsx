import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { ApprovalSummaryResponse } from '@/lib/api'
import { DEFAULT_LAYOUT, QUICK_ACTION_IDS, WIDGET_IDS } from '@/lib/dashboardLayout'
import { widgetRegistry } from '@/pages/dashboard/widgetRegistry'
import { DashboardRuntimeContext } from '@/pages/dashboard/widgets/dashboardWidgetContext'
import { QuickActionsWidget } from '@/pages/dashboard/widgets/QuickActionsWidget'
import type { WidgetTier } from '@/pages/dashboard/widgets/types'
import { WidgetFrame } from './WidgetFrame'
import { AddWidgetsPanel } from './CustomizeWidgets'

const approvalSummary: ApprovalSummaryResponse = {
  available_received_kinds: ['approver'],
  can_view_sent: true,
  signature: { count: 0 },
  review: { count: 0 },
  sent: { count: 0 },
  returned_count: 0,
  actionable_count: 0,
}

describe('available widget catalog', () => {
  it('registers every live id and no retired ids', () => {
    expect(Object.keys(widgetRegistry).sort()).toEqual([...WIDGET_IDS].sort())
    expect(Object.keys(widgetRegistry)).not.toContain('recent_docs')
    expect(Object.keys(widgetRegistry)).not.toContain('recent_ledger')
    expect(Object.keys(widgetRegistry)).not.toContain('email_sync_status')
  })
  it('gates approval work by summary rather than an assumed approval capability', () => {
    expect(widgetRegistry.waiting_approvals.available({ has: () => true })).toBe(false)
    expect(widgetRegistry.waiting_approvals.available({ has: () => false, approvalSummary })).toBe(true)
  })
  it.each(['books.view', 'documents.generate', 'books.service.Inmate Conduct Violations', 'books.servicerecords.Inmate Conduct Violations'])('requires %s for monthly reports', (denied) => {
    expect(widgetRegistry.violation_months.available({ has: (cap) => cap !== denied })).toBe(false)
  })
  it('shows workforce for either access capability, but not while caps load', () => {
    for (const cap of ['workforce.self.view', 'workforce.dashboard.view']) {
      expect(widgetRegistry.workforce_pulse.available({ has: (value) => value === cap })).toBe(true)
    }
    expect(widgetRegistry.workforce_pulse.available({ has: () => true, capabilitiesLoading: true })).toBe(false)
    expect(widgetRegistry.workforce_pulse.available({ has: () => false })).toBe(false)
  })
  it('lists available widgets first and moves an added widget to the collapsed dashboard list', async () => {
    const user = userEvent.setup()
    function Catalog() {
      const [widgets, setWidgets] = useState(DEFAULT_LAYOUT.widgets)
      return <AddWidgetsPanel
        entries={[{ id: 'pending', title: 'My documents', source: 'records' }, { id: 'violations', title: 'Open violations', source: 'records' }]}
        widgets={widgets}
        onAdd={(id) => setWidgets((current) => current.map((item) => item.id === id ? { ...item, visible: true } : item))}
        isSaving={false}
      />
    }
    render(<Catalog />)
    const available = screen.getByRole('region', { name: 'Available to add (1)' })
    expect(within(available).getByRole('button', { name: 'Add Open violations' })).toBeEnabled()
    expect(within(available).queryByText('My documents')).not.toBeInTheDocument()
    const onDashboard = screen.getByText('On your dashboard (1)')
    expect(available.compareDocumentPosition(onDashboard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('My documents')).not.toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add Open violations' }))
    expect(screen.queryByRole('button', { name: 'Add Open violations' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Available to add (0)' })).toHaveTextContent('All available widgets are on your dashboard.')
    await user.click(screen.getByText('On your dashboard (2)'))
    expect(screen.getByText('Open violations')).toBeVisible()
    expect(screen.getByText('My documents')).toBeVisible()
  })
})

describe('widget frame', () => {
  it('renders a zero count and an accessible view-all link with its body', () => {
    render(<MemoryRouter><WidgetFrame title="Test widget" count={0} viewAllTo="/books"><p>Body</p></WidgetFrame></MemoryRouter>)
    const frame = screen.getByRole('region', { name: 'Test widget' })
    expect(within(frame).getByText('0')).toBeInTheDocument()
    expect(within(frame).getByRole('link', { name: 'View all: Test widget' })).toHaveAttribute('href', '/books')
    expect(within(frame).getByText('Body')).toBeInTheDocument()
  })
})

describe('quick actions at every final box tier', () => {
  function actions(tier: WidgetTier, w: number, h: number, cols: number, has = () => true) {
    const layout = { ...DEFAULT_LAYOUT, quick_actions: DEFAULT_LAYOUT.quick_actions.map((item, index) => ({ ...item, visible: index < 8 })) }
    return render(<MemoryRouter><DashboardRuntimeContext.Provider value={{ layout, editing: false, box: { w, h, cols }, has, onNavigate: vi.fn(), onOpenCoverage: vi.fn() }}><QuickActionsWidget tier={tier} rows={h >= 2 ? 4 : 0} /></DashboardRuntimeContext.Provider></MemoryRouter>)
  }
  it.each<[WidgetTier, number, number, number, number]>([
    ['glance', 1, 1, 4, 2], ['summary', 2, 1, 4, 4], ['list', 2, 2, 4, 8],
    ['tall', 1, 2, 4, 4], ['summary', 6, 1, 6, 8], ['list', 2, 2, 2, 4],
  ])('fits %s at %ix%i on %i columns with %i tiles', (tier, w, h, cols, count) => {
    actions(tier, w, h, cols)
    expect(screen.getAllByRole('link')).toHaveLength(count + 1)
    expect(screen.getByRole('link', { name: 'General Book' })).toHaveAttribute('href', '/services/general_book')
  })
  it('filters tiles through their individual service access', () => {
    actions('list', 2, 2, 4, (cap?: string) => cap !== `books.service.${QUICK_ACTION_IDS[0]}`)
    expect(screen.queryByRole('link', { name: 'General Book' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(8)
  })
})
