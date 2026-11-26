import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type ArmoryAssignmentRead, type ArmoryAssignmentSummary, type SessionUser } from '@/lib/api'
import { ARMORY_EDIT_CAP, ARMORY_VIEW_CAP } from '@/lib/armory'
import { AuthContext } from '@/lib/authContext'
import i18n from '@/lib/i18n'

import { CustodyPane } from './CustodyPane'

const caps = vi.hoisted(() => ({ view: true, edit: false }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    has: (cap: string) => (cap === ARMORY_VIEW_CAP && caps.view) || (cap === ARMORY_EDIT_CAP && caps.edit),
  }),
}))
vi.mock(import('@/lib/api'), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, api: { ...actual.api, listArmoryCustody: vi.fn(), getArmoryCustody: vi.fn() } }
})

const user: SessionUser = {
  id: 71, email: 'custody@example.test', employee_id: null, name_en: 'Test User', name_ar: null,
  position: null, department: null, photo_url: null, role: 'operator', scoped_role: null,
  status: 'active', is_admin: false, is_manager: false, has_signature: false, idle_lock_seconds: 0, lock_layout: '',
}
const issuedAt = '2026-11-26T10:20:00Z'
const safe = { id: 17, name_en: 'Test Safe', name_ar: 'خزنة اختبار', vehicle_site: null, duty_post: null, created_at: issuedAt }
const firearm = { id: 71, name_en: 'Test Firearm', name_ar: 'سلاح اختبار', kind: 'firearm', category: 'firearms', drawing: 'pistol' } as const
const accessory = { id: 72, name_en: 'Test Accessory', name_ar: 'ملحق اختبار', kind: 'quantity', category: 'accessories', drawing: 'case' } as const
const active: ArmoryAssignmentRead = {
  id: 71, record_ref: 'TEST-CU-071', kind: 'custody', state: 'active', safe,
  holder: {
    kind: 'person', site_safe: null, supervisor: null,
    employee: { employee_id: 'T-0071', name_en: 'Test Custodian', name_ar: 'مستلم اختبار', employee_status: 'former', is_former: true },
  },
  issuer: { user_id: 72, employee: null, display_name: 'Test Armorer' },
  issued_at: issuedAt, due_at: null, overdue_minutes: null, licence_warning_acknowledged: true,
  changed_kit: false,
  lines: [
    { id: 71, item: firearm, qty: 1, remaining_qty: 1, serial_id: 71, serial_code: 'TEST-R-071', batch: null },
    { id: 72, item: accessory, qty: 2, remaining_qty: 0, serial_id: null, serial_code: null, batch: null },
  ],
  kit_id: 71, course_round_snapshot: 2, licence_status_at_issue: 'missing', shift_window: null, grace_minutes: null,
  off_duty_reason: null, off_duty_note: null, excess_rounds_reason: null, condition_note: 'Test detail note',
  ended_at: null, ended_by: null, return_ids: [92], voided_at: null, voided_by: null, void_reason: null,
  receipt: {
    record_ref: 'TEST-CU-071', issued_at: issuedAt, source_safe: safe,
    holder: { name_en: 'Test Original Custodian', name_ar: 'مستلم الاختبار الأصلي' }, holder_employee_id: 'T-0070',
    supervisor: null, supervisor_employee_id: null, armorer: { name_en: 'Test Original Armorer', name_ar: 'أمين الاختبار الأصلي' },
    firearm_included: true, licence_number: null, condition_note: 'Test receipt note',
    lines: [{ item: firearm, qty: 1, serial_code: 'TEST-R-071' }, { item: accessory, qty: 2, serial_code: null }],
  },
}
const ended: ArmoryAssignmentRead = {
  ...active, id: 72, record_ref: 'TEST-CU-072', state: 'ended', ended_at: '2026-11-27T08:00:00Z',
  ended_by: { user_id: 73, employee: null, display_name: 'Test Closing Armorer' },
  lines: active.lines.map((line) => ({ ...line, remaining_qty: 0 })),
}
const voided: ArmoryAssignmentRead = {
  ...active, id: 73, record_ref: 'TEST-CU-073', state: 'voided', voided_at: '2026-11-27T08:00:00Z',
  voided_by: { user_id: 73, employee: null, display_name: 'Test Voiding Armorer' }, void_reason: 'Test recording correction',
  lines: active.lines.map((line) => ({ ...line, remaining_qty: 0 })), return_ids: [],
}

const listCustody = vi.mocked(api.listArmoryCustody)
const getCustody = vi.mocked(api.getArmoryCustody)
const pageOf = (items: ArmoryAssignmentSummary[], page = 1, page_size = 50, total = items.length) => ({ items, page, page_size, total })

function renderPane(detail = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })
  const handover = vi.fn()
  const returnItems = vi.fn()
  render(
    <AuthContext.Provider value={{ user, status: 'authed', login: vi.fn(), logout: vi.fn(), refetch: vi.fn(), setUser: vi.fn() }}>
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[`/holdings/armory?tab=custody&safe=17${detail}`]}>
            <CustodyPane safeId={safe.id} onOpenHandover={handover} onOpenReturn={returnItems} />
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>
    </AuthContext.Provider>,
  )
  return { handover, returnItems }
}

beforeEach(async () => {
  vi.resetAllMocks()
  caps.view = true
  caps.edit = false
  await i18n.changeLanguage('en')
  listCustody.mockImplementation(async (filters) => pageOf(
    filters?.state === 'ended' ? [ended] : filters?.state === 'all' ? [active, ended, voided] : [active],
  ))
  getCustody.mockImplementation(async (id) => {
    if (id === ended.id) return ended
    if (id === voided.id) return voided
    if (id === active.id) return active
    throw new Error('Unexpected test record')
  })
})

afterEach(() => vi.restoreAllMocks())

describe('CustodyPane', () => {
  it('shows a viewer the custody evidence and printable snapshot without write controls', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    renderPane('&custody=71')

    const openReceipt = await screen.findByRole('button', { name: 'Print receipt' })
    const record = within(screen.getByRole('region', { name: 'Test Custodian' }))
    expect(within(screen.getByRole('region', { name: 'Custody' })).getByRole('button', { name: /TEST-CU-071/ })).toBeVisible()
    expect(record.getByText('26/11/2026 14:20')).toBeVisible()
    expect(record.getByText('Open custody on clearance')).toBeVisible()
    expect(record.getByText('Licence data warning acknowledged. This does not authorize release.')).toBeVisible()
    const line = within(record.getByRole('row', { name: /Test Accessory/ }))
    expect(line.getByRole('cell', { name: '0' })).toBeVisible()
    expect(line.getByRole('cell', { name: '2' })).toBeVisible()
    expect(record.getByRole('link', { name: 'Return 92' })).toHaveAttribute('href', '/holdings/armory?tab=audit&pane=movements&movement=92')
    expect(screen.queryByRole('button', { name: 'Hand over custody' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Return custody items' })).not.toBeInTheDocument()

    fireEvent.click(openReceipt)
    const sheet = within(screen.getAllByRole('article')[0])
    expect(sheet.getByText('Test Original Custodian')).toBeVisible()
    expect(sheet.getByText('T-0070')).toBeVisible()
    expect(sheet.getByText('Test receipt note')).toBeVisible()
    expect(sheet.getByRole('cell', { name: '2' })).toBeVisible()
    expect(sheet.queryByText('Test Custodian')).not.toBeInTheDocument()
    expect(sheet.queryByRole('cell', { name: '0' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    expect(print).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Back to custody' }))
    expect(await screen.findByRole('button', { name: 'Print receipt' })).toHaveFocus()
  })

  it('selects the server filter without dropping a detail outside that list', async () => {
    caps.edit = true
    renderPane('&custody=72')
    const list = within(screen.getByRole('region', { name: 'Custody' }))
    expect(await list.findByRole('button', { name: /TEST-CU-071/ })).toBeVisible()
    expect(list.queryByRole('button', { name: /TEST-CU-072/ })).not.toBeInTheDocument()
    expect(await screen.findByText('Test Closing Armorer')).toBeVisible()
    expect(getCustody).toHaveBeenCalledWith(72)
    expect(listCustody).toHaveBeenCalledWith(expect.objectContaining({ safe_id: 17, state: 'active', page: 1 }))
    expect(screen.queryByRole('button', { name: 'Return custody items' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print receipt' })).toBeVisible()

    fireEvent.click(list.getByRole('button', { name: 'Ended' }))
    expect(await list.findByRole('button', { name: /TEST-CU-072/ })).toBeVisible()
    expect(listCustody).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ended' }))
    expect(list.queryByRole('button', { name: /TEST-CU-073/ })).not.toBeInTheDocument()
    fireEvent.click(list.getByRole('button', { name: 'All' }))
    expect(await list.findByRole('button', { name: /TEST-CU-073/ })).toBeVisible()
    expect(listCustody).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'all' }))
    expect(screen.getByText('Test Closing Armorer')).toBeVisible()
  })

  it('passes editor actions and their original buttons to the shell', async () => {
    caps.edit = true
    const callbacks = renderPane('&custody=71')
    const handover = screen.getByRole('button', { name: 'Hand over custody' })
    const returnItems = await screen.findByRole('button', { name: 'Return custody items' })
    fireEvent.click(handover)
    expect(callbacks.handover).toHaveBeenCalledExactlyOnceWith(handover)
    fireEvent.click(returnItems)
    expect(callbacks.returnItems).toHaveBeenCalledExactlyOnceWith(71, returnItems)
  })

  it('returns focus to the selected row when closing a phone detail', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((media) => ({
      media, matches: true, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(() => true),
    }))
    renderPane()
    const row = await screen.findByRole('button', { name: /TEST-CU-071/ })
    expect(getCustody).not.toHaveBeenCalled()
    fireEvent.click(row)
    expect(await screen.findByRole('heading', { name: 'Test Custodian' })).toHaveFocus()
    expect(screen.queryByRole('region', { name: 'Custody' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }))
    expect(row).toHaveFocus()
  })

  it('pages in server order and searches from the first page', async () => {
    listCustody.mockImplementation(async (filters) => {
      if (filters?.q) return pageOf([ended], 1, 1, 1)
      return filters?.page === 2 ? pageOf([ended], 2, 1, 2) : pageOf([active], 1, 1, 2)
    })
    renderPane()
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('button', { name: /TEST-CU-072/ })).toBeVisible()
    expect(listCustody).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))

    const search = screen.getByRole('searchbox', { name: 'Search holder, receipt or serial' })
    fireEvent.change(search, { target: { value: 'TEST-CU-072' } })
    await waitFor(() => expect(listCustody).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, q: 'TEST-CU-072' })))
    fireEvent.click(screen.getByRole('button', { name: 'Clear search filter' }))
    expect(search).toHaveValue('')
    expect(search).toHaveFocus()
    expect(await screen.findByRole('button', { name: /TEST-CU-071/ })).toBeVisible()
  })

  it('offers retry for a failed list instead of presenting an empty ledger', async () => {
    listCustody.mockRejectedValue(new Error('Test network failure'))
    renderPane()
    expect(screen.getByRole('status')).toHaveTextContent('Loading armory records')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this armory section.')
    expect(screen.queryByText('No custody records match.')).not.toBeInTheDocument()

    listCustody.mockResolvedValue(pageOf([]))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No custody records match.')).toBeVisible()
  })

  it('keeps the void evidence readable without return or receipt actions', async () => {
    caps.edit = true
    renderPane('&custody=73')
    expect(await screen.findByText('Test Voiding Armorer')).toBeVisible()
    const record = within(screen.getByRole('region', { name: 'Test Custodian' }))
    expect(record.getByText('Voided')).toBeVisible()
    expect(record.getByText('27/11/2026 12:00')).toBeVisible()
    expect(record.getByText('Test recording correction')).toBeVisible()
    expect(record.queryByRole('button', { name: 'Return custody items' })).not.toBeInTheDocument()
    expect(record.queryByRole('button', { name: 'Print receipt' })).not.toBeInTheDocument()
  })

  it('does not load a receipt deep link with edit but no view capability', () => {
    caps.view = false
    caps.edit = true
    renderPane('&receipt=71')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(getCustody).not.toHaveBeenCalled()
    expect(listCustody).not.toHaveBeenCalled()
  })

  it.each([
    { record: voided, case: 'voided' },
    { record: { ...active, kind: 'shift' as const }, case: 'not custody' },
    { record: { ...active, receipt: null }, case: 'missing its snapshot' },
  ])('keeps printing unavailable when the record is $case', async ({ record }) => {
    getCustody.mockResolvedValue(record)
    renderPane(`&receipt=${record.id}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('This custody receipt is unavailable.')
    expect(screen.queryByRole('button', { name: 'Print' })).not.toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })
})
