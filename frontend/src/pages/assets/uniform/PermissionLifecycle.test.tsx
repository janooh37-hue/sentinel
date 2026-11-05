import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type UniformAdjustmentRead, type UniformItemRead, type UniformReceiptRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { UniformPage } from './UniformPage'
import { uniformKeys } from './uniformQueries'

const state = vi.hoisted(() => ({ editable: true, mobile: false }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => cap !== 'uniform.edit' || state.editable }) }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => state.mobile }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { name_en: 'Current keeper', email: 'keeper@example.test' } }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const SUIT: UniformItemRead = {
  id: 1, name_en: 'Formal suit', name_ar: 'بدلة رسمية', description_en: '', description_ar: '',
  group_key: 'formal', drawing: 'suit', tracking: 'holder', default_qty: 1, sort_order: 0,
  archived_at: null, version: '1', sizes: [], holders: [],
}
const POLO: UniformItemRead = {
  ...SUIT, id: 2, name_en: 'Polo shirt', name_ar: 'قميص بولو', group_key: 'guard', drawing: 'polo', tracking: 'shelf',
  sizes: [{ id: 21, item_id: 2, label: 'M', on_hand: 8, min_qty: null, is_low: false, held_qty: 2, archived_at: null, sort_order: 0 }],
}
const JACKET: UniformItemRead = {
  ...POLO, id: 3, name_en: 'Winter jacket', name_ar: 'سترة شتوية', group_key: 'winter', drawing: 'jacket',
  sizes: [{ ...POLO.sizes[0], id: 31, item_id: 3, label: 'L' }],
}
const ALI = { employee_id: 'G3194', name_en: 'Ali Hassan', name_ar: null, held_total: 2, issued_total: 2, last_issued_on: '2026-10-01' }
const OMAR = { ...ALI, employee_id: 'G3200', name_en: 'Omar Hassan' }
const RECEIPT: UniformReceiptRead = {
  id: 5, created_at: '2026-10-01T08:00:00', created_by_id: 1, voided_at: null, voided_by_id: null, void_reason: null,
  received_on: '2026-10-01', reference: 'Original receipt', note: null, lines: [{ size_id: 21, qty: 8 }],
}
const ADJUSTMENT: UniformAdjustmentRead = {
  id: 6, created_at: '2026-10-02T08:00:00', created_by_id: 1, voided_at: null, voided_by_id: null, void_reason: null,
  adjusted_on: '2026-10-02', size_id: 21, delta: 1, reason: 'Original adjustment',
}

function mount(entry = '/holdings/uniform') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const content = () => <QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter initialEntries={[entry]}><UniformPage /></MemoryRouter></I18nextProvider></QueryClientProvider>
  const view = render(content())
  return { client, rerender: () => view.rerender(content()) }
}

beforeEach(async () => {
  vi.restoreAllMocks()
  state.editable = true
  state.mobile = false
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listUniformItems').mockResolvedValue([SUIT, POLO, JACKET])
  vi.spyOn(api, 'getUniformSummary').mockResolvedValue({ shelf_total: 16, holder_count: 2, suits_issued: 0, out_of_stock: 0, low_sizes: 0 })
  vi.spyOn(api, 'listUniformRecipients').mockImplementation(async (query = '') => [ALI, OMAR].filter(person => [person.employee_id, person.name_en].some(value => value.toLowerCase().includes(query.toLowerCase()))))
  vi.spyOn(api, 'lookupEmployees').mockImplementation(async ({ q } = {}) => ({
    items: [ALI, OMAR].filter(person => [person.employee_id, person.name_en].some(value => value.toLowerCase().includes((q ?? '').toLowerCase()))).map(person => ({
      id: person.employee_id, name_en: person.name_en, name_ar: null, department: null, position: null, position_ar: null, duty_unit: null, duty_post: null,
    })), total: 1, limit: 8, offset: 0,
  }))
  vi.spyOn(api, 'getUniformEmployee').mockImplementation(async employeeId => ({
    holdings: [{ employee_id: employeeId, item_id: 2, size_id: 21, qty: 2 }], issues: [], returns: [],
  }))
  vi.spyOn(api, 'listUniformReturns').mockResolvedValue([])
  vi.spyOn(api, 'listUniformReceipts').mockResolvedValue([RECEIPT])
  vi.spyOn(api, 'listUniformAdjustments').mockResolvedValue([ADJUSTMENT])
  vi.spyOn(api, 'voidUniformReceipt').mockResolvedValue({ ...RECEIPT, id: 15, voided_at: '2026-11-04T08:00:00' })
  vi.spyOn(api, 'voidUniformAdjustment').mockResolvedValue({ ...ADJUSTMENT, id: 16, voided_at: '2026-11-04T08:00:00' })
})

describe('Uniform global edit dialog permission lifecycle', () => {
  it.each(['give', 'return', 'shortcut'] as const)('discards the global %s draft and opens a fresh draft only from the next authorized trigger', async kind => {
    const user = userEvent.setup()
    const view = mount(kind === 'return' ? '/holdings/uniform?tab=returns' : '/holdings/uniform')
    await screen.findByRole('heading', { name: i18n.t('assets.uniform.title'), level: 1 })
    const opener = await screen.findByRole('button', { name: kind === 'return' ? 'Record return' : kind === 'shortcut' ? 'Add suit holder' : 'Hand out uniform' })
    await user.click(opener)
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('searchbox'), 'G3194')
    await user.click(await within(dialog).findByRole('button', { name: /Ali Hassan/ }))
    const piece = await within(dialog).findByRole('group', { name: 'Polo shirt' })
    if (kind === 'return') {
      await user.click(within(piece).getByRole('button', { name: 'Increase Polo shirt M' }))
      await user.click(within(piece).getByRole('radio', { name: 'Damaged' }))
    } else {
      await user.click(within(piece).getByRole('radio', { name: 'M 8 left' }))
      fireEvent.change(within(piece).getByRole('spinbutton'), { target: { value: '3' } })
    }
    state.editable = false
    view.rerender()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: i18n.t('assets.uniform.title'), level: 1 })).toHaveFocus())
    state.editable = true
    view.rerender()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    state.editable = false
    view.rerender()
    await user.click(screen.getByRole('link', { name: i18n.t(kind === 'return' ? 'assets.uniform.tabStock' : 'assets.uniform.tabReturns') }))
    await user.click(screen.getByRole('link', { name: i18n.t(kind === 'return' ? 'assets.uniform.tabReturns' : 'assets.uniform.tabStock') }))
    state.editable = true
    view.rerender()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: kind === 'return' ? 'Record return' : 'Hand out uniform' }))
    const nextDialog = await screen.findByRole('dialog')
    expect(nextDialog).not.toBe(dialog)
    expect(within(nextDialog).getByRole('searchbox')).toHaveValue('')
    expect(within(nextDialog).queryByText('G3194')).not.toBeInTheDocument()
    await user.type(within(nextDialog).getByRole('searchbox'), 'G3200')
    await user.click(await within(nextDialog).findByRole('button', { name: /Omar Hassan/ }))
    expect(within(nextDialog).getByText('G3200')).toBeInTheDocument()
    if (kind === 'return') {
      const nextPiece = await within(nextDialog).findByRole('group', { name: 'Polo shirt' })
      expect(within(nextPiece).getByRole('spinbutton')).toHaveValue(0)
      expect(within(nextPiece).getByRole('radio', { name: 'Reusable' })).toBeChecked()
    } else {
      await within(nextDialog).findByRole('group', { name: 'Polo shirt' })
      expect(within(nextDialog).queryByRole('spinbutton')).not.toBeInTheDocument()
      expect(within(within(nextDialog).getByRole('group', { name: 'Formal suit' })).getByRole('radio', { name: 'None' })).toBeChecked()
    }
  })
})

describe.each([false, true])('Stock edit dialog permission lifecycle, mobile=%s', mobile => {
  it.each(['add', 'edit', 'receive'] as const)('discards the %s draft permanently on permission loss and uses the current catalogue for a fresh opening', async kind => {
    state.mobile = mobile
    const user = userEvent.setup()
    const view = mount()
    const piece = await screen.findByText('Polo shirt')
    const row = piece.closest(mobile ? 'article' : 'tr')!
    const opener = kind === 'edit' ? within(row).getByRole('button', { name: 'Update' })
      : screen.getByRole('button', { name: kind === 'add' ? 'Add item' : 'Receive stock' })
    await user.click(opener)
    const dialog = await screen.findByRole('dialog')
    if (kind === 'receive') {
      await user.type(within(dialog).getByLabelText('Reference'), 'Revoked reference')
      fireEvent.change(await within(dialog).findByRole('spinbutton', { name: 'Quantity of Polo shirt M' }), { target: { value: '5' } })
    } else {
      const name = await within(dialog).findByLabelText('Name in English')
      await user.clear(name)
      await user.type(name, 'Revoked item draft')
      if (kind === 'edit') {
        fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Quantity of M' }), { target: { value: '6' } })
        await user.type(within(dialog).getByLabelText('Reason for adjustment'), 'Revoked adjustment')
      }
    }
    state.editable = false
    view.rerender()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: i18n.t('assets.uniform.title'), level: 1 })).toHaveFocus())
    state.editable = true
    view.rerender()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    state.editable = false
    view.rerender()
    vi.mocked(api.listUniformItems).mockResolvedValue([SUIT, JACKET])
    await act(async () => { view.client.setQueryData(uniformKeys.items(), [SUIT, JACKET]) })
    await waitFor(() => expect(screen.queryByText('Polo shirt')).not.toBeInTheDocument())
    state.editable = true
    view.rerender()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const nextRow = screen.getByText('Winter jacket').closest(mobile ? 'article' : 'tr')!
    await user.click(kind === 'edit' ? within(nextRow).getByRole('button', { name: 'Update' })
      : screen.getByRole('button', { name: kind === 'add' ? 'Add item' : 'Receive stock' }))
    const nextDialog = await screen.findByRole('dialog')
    expect(nextDialog).not.toBe(dialog)
    if (kind === 'receive') {
      expect(within(nextDialog).getByLabelText('Reference')).toHaveValue('')
      expect(await within(nextDialog).findByRole('spinbutton', { name: 'Quantity of Winter jacket L' })).toHaveValue(0)
      expect(within(nextDialog).queryByRole('spinbutton', { name: 'Quantity of Polo shirt M' })).not.toBeInTheDocument()
    } else {
      expect(await within(nextDialog).findByLabelText('Name in English')).toHaveValue(kind === 'add' ? '' : 'Winter jacket')
      if (kind === 'edit') {
        expect(within(nextDialog).getByRole('spinbutton', { name: 'Quantity of L' })).toHaveValue(8)
        expect(within(nextDialog).queryByLabelText('Reason for adjustment')).not.toBeInTheDocument()
        fireEvent.change(within(nextDialog).getByRole('spinbutton', { name: 'Quantity of L' }), { target: { value: '7' } })
        expect(within(nextDialog).getByLabelText('Reason for adjustment')).toHaveValue('')
      }
    }
  })
})

describe('Stock history edit confirmation permission lifecycle', () => {
  it.each(['receipt', 'adjustment'] as const)('keeps read-only history mounted but discards the %s confirmation, snapshot and reason on revocation', async kind => {
    const user = userEvent.setup()
    const view = mount()
    const row = (await screen.findByText('Polo shirt')).closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Stock history' }))
    const dialog = await screen.findByRole('dialog')
    const entry = within(dialog).getByText(kind === 'receipt' ? /Original receipt/ : /Original adjustment/).closest('li')!
    await user.click(within(entry).getByRole('button', { name: 'Void record' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason for voiding' }), 'Revoked confirmation reason')
    state.editable = false
    view.rerender()
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(within(dialog).queryByRole('textbox', { name: 'Reason for voiding' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Void record' })).not.toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getAllByRole('button', { name: 'Close' }).some(button => button === document.activeElement)).toBe(true))
    const nextReceipt = { ...RECEIPT, id: 15, reference: 'New receipt' }
    const nextAdjustment = { ...ADJUSTMENT, id: 16, reason: 'New adjustment' }
    vi.mocked(api.listUniformReceipts).mockResolvedValue([nextReceipt])
    vi.mocked(api.listUniformAdjustments).mockResolvedValue([nextAdjustment])
    await act(async () => {
      view.client.setQueryData(uniformKeys.receipts, [nextReceipt])
      view.client.setQueryData(uniformKeys.adjustments, [nextAdjustment])
    })
    await waitFor(() => expect(within(dialog).queryAllByText(/Original receipt|Original adjustment/)).toHaveLength(0))
    state.editable = true
    view.rerender()
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(within(dialog).queryByRole('textbox', { name: 'Reason for voiding' })).not.toBeInTheDocument()
    const nextEntry = within(dialog).getByText(kind === 'receipt' ? /New receipt/ : /New adjustment/).closest('li')!
    await user.click(within(nextEntry).getByRole('button', { name: 'Void record' }))
    const reason = within(dialog).getByRole('textbox', { name: 'Reason for voiding' })
    expect(reason).toHaveValue('')
    await user.type(reason, 'New authorized reason')
    await user.click(within(nextEntry).getByRole('button', { name: 'Void record' }))
    await waitFor(() => expect(kind === 'receipt' ? api.voidUniformReceipt : api.voidUniformAdjustment).toHaveBeenCalledExactlyOnceWith(kind === 'receipt' ? 15 : 16, { reason: 'New authorized reason' }))
  })
})
