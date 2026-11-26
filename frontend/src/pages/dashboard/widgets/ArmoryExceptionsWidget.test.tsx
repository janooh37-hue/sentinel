import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, type ArmoryAlertsRead, type ArmoryAssignmentSummary, type ArmorySerialRead } from '@/lib/api'
import type * as ApiModule from '@/lib/api'
import { ARMORY_EDIT_CAP, ARMORY_VIEW_CAP } from '@/lib/armory'
import i18n from '@/lib/i18n'
import { widgetRegistry } from '../widgetRegistry'
import { ArmoryExceptionsWidget } from './ArmoryExceptionsWidget'
import type { WidgetTier } from './types'

const access = vi.hoisted(() => ({ view: true, edit: false }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return { ...actual, api: { ...actual.api, getArmorySummary: vi.fn(), createArmoryReturn: vi.fn() } }
})
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1 } }) }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    has: (cap: string) => (cap === ARMORY_VIEW_CAP && access.view) || (cap === ARMORY_EDIT_CAP && access.edit),
    isLoading: false,
  }),
}))

const EMPTY: ArmoryAlertsRead = {
  now_at: '2026-01-01T12:45:00Z',
  missing_firearm_count: 0,
  missing_firearms: [],
  overdue_count: 0,
  overdue: [],
  decision_count: 0,
  due_check_count: 0,
  expired_batch_count: 0,
  expiring_batch_count: 0,
  licences: { missing: 0, expired: 0, expiring: 0, valid: 1 },
  former_open_count: 0,
}

const SAFE = {
  id: 7, name_en: 'Test Safe', name_ar: 'خزنة الاختبار', vehicle_site: null, duty_post: null, created_at: '2026-01-01T00:00:00Z',
}
const MISSING: ArmorySerialRead = {
  id: 3, serial_code: 'TEST-R-003', safe: SAFE,
  item: { id: 2, name_en: 'Test Firearm', name_ar: 'سلاح الاختبار', kind: 'firearm', category: 'firearms', drawing: 'rifle' },
  state: 'missing', state_at: '2026-01-01T10:00:00Z', last_posting_id: 8, assignment_id: null,
  holder: null, overdue_minutes: null,
}
const LATE: ArmoryAssignmentSummary = {
  id: 9, record_ref: 'TEST-ISSUE-9', kind: 'shift', state: 'active', safe: SAFE,
  holder: {
    kind: 'person', employee: { employee_id: 'T-0001', name_en: 'Test Guard One', name_ar: 'حارس الاختبار الأول', employee_status: 'active', is_former: false },
    site_safe: null, supervisor: null,
  },
  issuer: { user_id: 2, employee: null, display_name: null },
  issued_at: '2026-01-01T09:00:00Z', due_at: '2026-01-01T11:30:00Z', overdue_minutes: 75,
  licence_warning_acknowledged: false, changed_kit: false,
  lines: [{ id: 10, item: MISSING.item, qty: 1, remaining_qty: 1, serial_id: 4, serial_code: 'TEST-R-004', batch: null }],
}
const ALERTS: ArmoryAlertsRead = {
  ...EMPTY,
  missing_firearm_count: 1, missing_firearms: [MISSING],
  overdue_count: 1, overdue: [LATE],
  decision_count: 2, due_check_count: 1,
  expired_batch_count: 2, expiring_batch_count: 1,
  licences: { missing: 1, expired: 1, expiring: 2, valid: 3 },
  former_open_count: 1,
}

function CurrentLocation() {
  const { pathname, search } = useLocation()
  return <output>{pathname}{search}</output>
}

function renderWidget(tier: WidgetTier = 'list', rows = 4) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ArmoryExceptionsWidget tier={tier} rows={rows} />
          <CurrentLocation />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  vi.resetAllMocks()
  access.view = true
  access.edit = false
  vi.mocked(api.getArmorySummary).mockResolvedValue(ALERTS)
  await i18n.changeLanguage('en')
})

describe('ArmoryExceptionsWidget', () => {
  it('orders missing, overdue and secondary exceptions, with real detail destinations', async () => {
    renderWidget()
    const frame = within(screen.getByRole('region', { name: 'Armory exceptions' }))
    const missing = await frame.findByRole('link', { name: /TEST-R-003/ })
    const late = frame.getByRole('link', { name: /TEST-ISSUE-9.*Overdue by 1 h 15 min/ })
    const decision = frame.getByRole('link', { name: 'Needs a decision: 2' })
    const ordered = [
      frame.getByRole('link', { name: '1 firearm missing' }), missing,
      frame.getByRole('link', { name: 'Overdue: 1' }), late, decision,
      frame.getByRole('link', { name: '1 shift check due' }),
      frame.getByRole('link', { name: 'Expired: 2 batches' }),
      frame.getByRole('link', { name: 'Expiring soon: 1 batch' }),
      frame.getByRole('link', { name: '4 licences need attention' }),
      frame.getByRole('link', { name: '1 open holding with a former guard' }),
    ]
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i - 1]!.compareDocumentPosition(ordered[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(missing).toHaveAttribute('href', '/holdings/armory?tab=items&serial=3')
    expect(late).toHaveAttribute('href', '/holdings/armory?tab=shift&issue=9')
    expect(decision).toHaveAttribute('href', '/holdings/armory?tab=audit&pane=decisions')
    expect(frame.getByRole('link', { name: 'View all: Armory exceptions' })).toHaveAttribute('href', '/holdings/armory')
    expect(frame.queryByRole('link', { name: /^Return/ })).not.toBeInTheDocument()
    expect(api.getArmorySummary).toHaveBeenCalledWith(undefined)
  })

  it('lets an editor navigate to the Return draft without posting a return', async () => {
    access.edit = true
    renderWidget('tall')
    const to = '/holdings/armory?tab=shift&issue=9&return=1'
    const action = await screen.findByRole('link', { name: 'Return TEST-ISSUE-9' })
    expect(action).toHaveAttribute('href', to)
    await userEvent.click(action)
    expect(screen.getByText(to)).toBeInTheDocument()
    expect(api.createArmoryReturn).not.toHaveBeenCalled()
  })

  it.each<WidgetTier>(['summary', 'glance'])('uses a compact breakdown without detail rows at %s tier', async (tier) => {
    renderWidget(tier, 0)
    expect(await screen.findByRole('link', { name: '1 firearm missing' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Overdue: 1' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /TEST-R-003|TEST-ISSUE-9/ })).not.toBeInTheDocument()
  })

  it('isolates serials, elapsed numbers, and counts in Arabic', async () => {
    await i18n.changeLanguage('ar')
    renderWidget()
    const frame = within(screen.getByRole('region', { name: 'تنبيهات خزنة السلاح' }))
    const missing = await frame.findByRole('link', { name: /TEST-R-003/ })
    expect(missing.querySelector('bdi[dir="ltr"]')).toHaveTextContent('TEST-R-003')
    const count = frame.getByRole('link', { name: 'أسلحة مفقودة: 1' })
    expect(count.querySelector('bdi[dir="ltr"]')).toHaveTextContent('1')
    const late = frame.getByRole('link', { name: /متأخر منذ 1 س 15 د/ })
    const elapsed = Array.from(late.querySelectorAll('bdi[dir="ltr"]'), (part) => part.textContent)
    expect(elapsed).toEqual(expect.arrayContaining(['1', '15']))
  })

  it('shows loading and an empty summary inside the frame', async () => {
    vi.mocked(api.getArmorySummary).mockResolvedValue(EMPTY)
    renderWidget()
    const frame = within(screen.getByRole('region', { name: 'Armory exceptions' }))
    expect(frame.getByRole('status', { name: 'Loading…' })).toBeInTheDocument()
    expect(await frame.findByText('No armory alerts.')).toBeInTheDocument()
  })

  it('shows a retryable error inside the frame, not an empty summary', async () => {
    vi.mocked(api.getArmorySummary).mockRejectedValue(new Error('offline'))
    renderWidget()
    const frame = within(screen.getByRole('region', { name: 'Armory exceptions' }))
    const error = within(await frame.findByRole('alert'))
    expect(frame.queryByText('No armory alerts.')).not.toBeInTheDocument()
    vi.mocked(api.getArmorySummary).mockResolvedValue(EMPTY)
    await userEvent.click(error.getByRole('button', { name: 'Retry' }))
    expect(await frame.findByText('No armory alerts.')).toBeInTheDocument()
  })

  it('requires view access at registration and skips the protected query even when rendered directly', () => {
    access.view = false
    access.edit = true
    const widget = widgetRegistry.armory_exceptions
    expect(widget.available({ has: (cap) => cap === ARMORY_EDIT_CAP })).toBe(false)
    expect(widget.available({ has: (cap) => cap === ARMORY_VIEW_CAP })).toBe(true)
    expect(widget.source).toBe('armory')
    renderWidget()
    expect(screen.queryByRole('region', { name: 'Armory exceptions' })).not.toBeInTheDocument()
    expect(api.getArmorySummary).not.toHaveBeenCalled()
  })
})
