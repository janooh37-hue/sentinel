import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type UniformItemRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { todayIso } from '@/lib/leaveDateMath'
import { HandOutDialog } from './HandOutDialog'
import { UniformPage } from './UniformPage'
import { whole } from './quantity'
import { ReceiveStockDialog } from './stock/ReceiveStockDialog'
import { uniformKeys } from './uniformQueries'

const state = vi.hoisted(() => ({ editable: true, mobile: false }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => cap !== 'uniform.edit' || state.editable }) }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => state.mobile }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { display_name: 'Store keeper', name_en: 'Store keeper', email: 'keeper@example.test' } }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const SUIT: UniformItemRead = { id: 1, name_en: 'Formal suit', name_ar: 'بدلة رسمية', description_en: 'Tailored', description_ar: 'مفصلة', group_key: 'formal', drawing: 'suit', tracking: 'holder', default_qty: 2, sort_order: 0, archived_at: null, version: '1', sizes: [], holders: [] }
const POLO: UniformItemRead = { ...SUIT, id: 2, name_en: 'Polo shirt', name_ar: 'قميص بولو', group_key: 'guard', drawing: 'polo', tracking: 'shelf', sizes: [
  { id: 21, item_id: 2, label: 'M', on_hand: 8, min_qty: null, is_low: false, held_qty: 0, archived_at: null, sort_order: 0 },
  { id: 22, item_id: 2, label: 'L', on_hand: 1, min_qty: 2, is_low: true, held_qty: 0, archived_at: null, sort_order: 1 },
  { id: 23, item_id: 2, label: 'XL', on_hand: 0, min_qty: null, is_low: false, held_qty: 0, archived_at: null, sort_order: 2 },
] }
const EMPLOYEE = { id: 'G3194', name_en: 'Ali Hassan', name_ar: 'علي حسن', department: null, position: null, position_ar: null, duty_unit: null, duty_post: null }

function mount(page: boolean | 'receipt' = false, itemId?: number) {
  const onOpenChange = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/holdings/uniform']}>
    {page === 'receipt' ? <ReceiveStockDialog open onOpenChange={onOpenChange} itemId={itemId} /> : page ? <UniformPage /> : <HandOutDialog open onOpenChange={onOpenChange} itemId={itemId} />}
  </MemoryRouter></I18nextProvider></QueryClientProvider>)
  return { onOpenChange, client }
}
async function chooseEmployee() {
  const user = userEvent.setup()
  await user.type(await screen.findByRole('searchbox'), 'G3194')
  await screen.findByRole('button', { name: /Ali Hassan/ })
  await user.keyboard('{Enter}')
  return user
}

beforeEach(async () => {
  vi.restoreAllMocks()
  state.editable = true
  state.mobile = false
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listUniformItems').mockResolvedValue([SUIT, POLO])
  vi.spyOn(api, 'getUniformSummary').mockResolvedValue({ shelf_total: 9, holder_count: 0, suits_issued: 0, out_of_stock: 1, low_sizes: 1 })
  vi.spyOn(api, 'lookupEmployees').mockResolvedValue({ items: [EMPLOYEE], total: 1, limit: 8, offset: 0 })
  vi.spyOn(api, 'createUniformIssue').mockResolvedValue({ id: 1, created_at: '2026-11-04T08:00:00', created_by_id: 1, voided_at: null, voided_by_id: null, void_reason: null, employee_id: EMPLOYEE.id, issued_on: '2026-11-04', note: null, lines: [] })
  vi.spyOn(api, 'createUniformReceipt').mockResolvedValue({ id: 2, created_at: '2026-11-04T08:00:00', created_by_id: 1, voided_at: null, voided_by_id: null, void_reason: null, received_on: '2026-11-04', reference: null, note: null, lines: [] })
})

describe('Hand out uniform', () => {
  it('explains employee and piece requirements and defaults every piece to None', async () => {
    mount()
    await screen.findByRole('radio', { name: 'Give' })
    const save = await screen.findByRole('button', { name: 'Hand out' })
    expect(save).toBeDisabled()
    expect(save).toHaveAccessibleDescription('Choose the employee taking the uniform.')
    await chooseEmployee()
    expect(save).toBeDisabled()
    expect(save).toHaveAccessibleDescription('Choose at least one piece.')
    expect(screen.getAllByRole('radio', { name: 'None' }).every(radio => radio.hasAttribute('checked'))).toBe(true)
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('defaults a shelf choice, clamps a scarce size immediately and disables empty sizes', async () => {
    mount()
    const user = await chooseEmployee()
    const group = within(screen.getByRole('group', { name: 'Polo shirt' }))
    expect(group.getByRole('radio', { name: 'XL 0 left' })).toBeDisabled()
    await user.click(group.getByRole('radio', { name: 'M 8 left' }))
    expect(group.getByRole('spinbutton')).toHaveValue(2)
    await user.click(group.getByRole('radio', { name: 'L 1 left' }))
    expect(group.getByRole('spinbutton')).toHaveValue(1)
    expect(group.getByRole('status')).toHaveTextContent('Only 1 left.')
    expect(group.getByRole('button', { name: 'Increase Polo shirt' })).toBeDisabled()
  })

  it.each([['99', 8], ['-4', 1], ['2.9', 2], ['', 1], ['0', 1]])('commits quantity %s as %s and sends the corrected quantity', async (raw, expected) => {
    mount()
    const user = await chooseEmployee()
    await user.click(screen.getByRole('radio', { name: 'M 8 left' }))
    const input = screen.getByRole('spinbutton', { name: 'Quantity of Polo shirt' })
    fireEvent.change(input, { target: { value: raw } })
    fireEvent.blur(input)
    expect(input).toHaveValue(expected)
    await user.click(screen.getByRole('button', { name: 'Hand out' }))
    await waitFor(() => expect(api.createUniformIssue).toHaveBeenCalledWith(expect.objectContaining({ employee_id: EMPLOYEE.id, lines: [{ item_id: 2, size_id: 21, qty: expected }] })))
  })

  it('keeps picks attached to item IDs when the live catalogue adds and reorders items', async () => {
    const { client } = mount()
    const user = await chooseEmployee()
    await user.click(screen.getByRole('radio', { name: 'Give' }))
    await user.click(screen.getByRole('radio', { name: 'M 8 left' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity of Polo shirt' }), { target: { value: '3' } })
    const belt: UniformItemRead = { ...POLO, id: 3, name_en: 'Belt', drawing: 'belt', default_qty: 1, sizes: [{ ...POLO.sizes[0], id: 31, item_id: 3, label: 'one' }] }
    act(() => { client.setQueryData(uniformKeys.items(), [belt, POLO, SUIT]) })
    const beltGroup = within(await screen.findByRole('group', { name: 'Belt' }))
    expect(beltGroup.getByRole('radio', { name: 'None' })).toBeChecked()
    expect(screen.getByRole('spinbutton', { name: 'Quantity of Formal suit' })).toHaveValue(2)
    expect(screen.getByRole('spinbutton', { name: 'Quantity of Polo shirt' })).toHaveValue(3)
    await user.click(screen.getByRole('button', { name: 'Increase Polo shirt' }))
    expect(screen.getByRole('spinbutton', { name: 'Quantity of Polo shirt' })).toHaveValue(4)
    await user.click(screen.getByRole('button', { name: 'Hand out' }))
    await waitFor(() => expect(api.createUniformIssue).toHaveBeenCalledWith(expect.objectContaining({
      lines: [{ item_id: 2, size_id: 21, qty: 4 }, { item_id: 1, qty: 2 }],
    })))
  })

  it('drops removed items without moving their picks onto remaining catalogue items', async () => {
    const { client } = mount()
    const user = await chooseEmployee()
    await user.click(screen.getByRole('radio', { name: 'Give' }))
    await user.click(screen.getByRole('radio', { name: 'M 8 left' }))
    act(() => { client.setQueryData(uniformKeys.items(), [POLO]) })
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Formal suit' })).not.toBeInTheDocument())
    expect(screen.getByRole('radio', { name: 'M 8 left' })).toBeChecked()
    const qty = screen.getByRole('spinbutton', { name: 'Quantity of Polo shirt' })
    fireEvent.change(qty, { target: { value: '3.9' } })
    fireEvent.blur(qty)
    expect(qty).toHaveValue(3)
    await user.click(screen.getByRole('button', { name: 'Hand out' }))
    await waitFor(() => expect(api.createUniformIssue).toHaveBeenCalledWith(expect.objectContaining({
      lines: [{ item_id: 2, size_id: 21, qty: 3 }],
    })))
  })

  it('marks selected choices with a non-color checkmark', async () => {
    mount()
    const radio = await screen.findByRole('radio', { name: 'Give' })
    const marker = radio.closest('label')?.querySelector('[aria-hidden="true"]')
    expect(marker).toHaveTextContent('✓')
    expect(marker).toHaveAttribute('aria-hidden', 'true')
    expect(marker).toHaveClass('peer-checked:block')
    await userEvent.click(radio)
    expect(radio).toBeChecked()
  })

  it('preselects only the requested suit and accepts quantities without a shelf cap', async () => {
    const { onOpenChange, client } = mount(false, SUIT.id)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const user = await chooseEmployee()
    expect(screen.getByRole('radio', { name: 'Give' })).toBeChecked()
    const qty = screen.getByRole('spinbutton', { name: 'Quantity of Formal suit' })
    expect(qty).toHaveValue(2)
    fireEvent.change(qty, { target: { value: '17' } })
    await user.click(screen.getByRole('button', { name: 'Hand out' }))
    await waitFor(() => expect(api.createUniformIssue).toHaveBeenCalledWith(expect.objectContaining({ lines: [{ item_id: 1, qty: 17 }] })))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['uniform'] })
  })

  it.each(['Give suit', 'Add suit holder'])('opens from %s, focuses search and returns focus after cancel', async label => {
    mount(true)
    const user = userEvent.setup()
    const opener = await screen.findByRole('button', { name: label })
    await user.click(opener)
    expect(await screen.findByRole('searchbox')).toHaveFocus()
    await chooseEmployee()
    expect(screen.getByRole('radio', { name: 'Give' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  it.each([false, true])('hides all mutations in readonly stock and refuses direct dialog rendering (mobile=%s)', async mobile => {
    state.editable = false
    state.mobile = mobile
    mount(true)
    await screen.findAllByText('Polo shirt')
    expect(screen.queryByRole('button', { name: /Hand out|Give suit|Add suit holder|Update|Add item|Receive stock/ })).not.toBeInTheDocument()
    mount()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('retains choices after a stock conflict and shows the translated error', async () => {
    vi.mocked(api.createUniformIssue).mockRejectedValue(new ApiError(409, 'uniform_insufficient_stock', 'Conflict'))
    mount()
    const user = await chooseEmployee()
    await user.click(screen.getByRole('radio', { name: 'M 8 left' }))
    await user.click(screen.getByRole('button', { name: 'Hand out' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not enough stock on the shelf.')
    expect(screen.getByRole('spinbutton')).toHaveValue(2)
    expect(screen.getByText('Ali Hassan')).toBeInTheDocument()
  })

  it('renders Arabic Give separately from submit and announces the Arabic scarcity plural', async () => {
    await i18n.changeLanguage('ar')
    mount(false, SUIT.id)
    const user = userEvent.setup()
    await user.type(await screen.findByRole('searchbox'), 'G3194')
    await user.click(await screen.findByRole('button', { name: /علي حسن/ }))
    expect(screen.getByRole('radio', { name: 'تسليم' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: /L.*1/ }))
    expect(screen.getAllByRole('status').some(status => status.textContent?.includes('المتبقي قطعة واحدة فقط.'))).toBe(true)
    expect(screen.getByRole('button', { name: 'صرف' })).toBeEnabled()
  })

  it('shows catalog errors with retry rather than an empty form', async () => {
    vi.mocked(api.listUniformItems).mockRejectedValue(new Error('offline'))
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load uniform stock.")
    expect(screen.getByRole('button', { name: 'Hand out' })).toBeDisabled()
    vi.mocked(api.listUniformItems).mockResolvedValue([SUIT, POLO])
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('radio', { name: 'Give' })).toBeInTheDocument()
  })

  it('supports result arrows and Enter without submitting the form', async () => {
    const second = { ...EMPLOYEE, id: 'G3200', name_en: 'Second employee' }
    vi.mocked(api.lookupEmployees).mockResolvedValue({ items: [EMPLOYEE, second], total: 2, limit: 8, offset: 0 })
    mount()
    const user = userEvent.setup()
    await user.type(await screen.findByRole('searchbox'), 'employee')
    const first = await screen.findByRole('button', { name: /Ali Hassan/ })
    const last = screen.getByRole('button', { name: /Second employee/ })
    await user.keyboard('{ArrowDown}')
    expect(first).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(last).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(first).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByText('Ali Hassan')).toBeInTheDocument()
    expect(api.createUniformIssue).not.toHaveBeenCalled()
  })

  it('offers a retry for lookup errors and explains an empty search result', async () => {
    vi.mocked(api.lookupEmployees).mockRejectedValue(new Error('offline'))
    mount()
    const user = userEvent.setup()
    await user.type(await screen.findByRole('searchbox'), 'missing')
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('assets.uniform.lookupError'))
    vi.mocked(api.lookupEmployees).mockResolvedValue({ items: [], total: 0, limit: 8, offset: 0 })
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No employee matches.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hand out' })).toBeDisabled()
  })

  it('uses one-size defaults from the catalogue and never submits a size for a holder', async () => {
    const belt: UniformItemRead = { ...POLO, id: 3, name_en: 'Belt', drawing: 'belt', default_qty: 1, sizes: [{ ...POLO.sizes[0], id: 31, item_id: 3, label: 'one' }] }
    vi.mocked(api.listUniformItems).mockResolvedValue([SUIT, belt])
    mount()
    const user = await chooseEmployee()
    await user.click(screen.getByRole('radio', { name: 'One size 8 left' }))
    expect(screen.getByRole('spinbutton', { name: 'Quantity of Belt' })).toHaveValue(1)
    await user.click(screen.getByRole('radio', { name: 'Give' }))
    await user.click(screen.getByRole('button', { name: 'Hand out' }))
    await waitFor(() => expect(api.createUniformIssue).toHaveBeenCalledWith(expect.objectContaining({ lines: [{ item_id: 1, qty: 2 }, { item_id: 3, size_id: 31, qty: 1 }] })))
  })

  it('restores the shortcut focus after a successful save', async () => {
    mount(true)
    const user = userEvent.setup()
    const trigger = await screen.findByRole('button', { name: 'Add suit holder' })
    await user.click(trigger)
    await chooseEmployee()
    await user.click(screen.getByRole('button', { name: 'Hand out' }))
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each(['en', 'ar'])('describes an empty catalogue as an empty state in %s', async lang => {
    await i18n.changeLanguage(lang)
    vi.mocked(api.listUniformItems).mockResolvedValue([])
    mount(true)
    expect(await screen.findByText(i18n.t('assets.uniform.noItems'))).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Receive uniform stock', () => {
  it('submits floored per-size quantities with the receipt date and trimmed reference and note', async () => {
    const { onOpenChange } = mount('receipt', POLO.id)
    const user = userEvent.setup()
    const qty = await screen.findByRole('spinbutton', { name: 'Quantity of Polo shirt M' })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(qty, { target: { value: '2.9' } })
    fireEvent.blur(qty)
    expect(qty).toHaveValue(2)
    await user.type(screen.getByLabelText('Reference'), ' HQ-42 ')
    await user.type(screen.getByLabelText('Note'), ' Delivery ')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.createUniformReceipt).toHaveBeenCalledWith({
      received_on: todayIso(), reference: 'HQ-42', note: 'Delivery', lines: [{ size_id: 21, qty: 2 }],
    }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('keeps Save disabled for future receipt dates and explains the reason', async () => {
    mount('receipt')
    const qty = await screen.findByRole('spinbutton', { name: 'Quantity of Polo shirt M' })
    fireEvent.change(qty, { target: { value: '1' } })
    const date = screen.getByLabelText(i18n.t('assets.uniform.receivedOn'))
    fireEvent.change(date, { target: { value: '2999-01-01' } })
    const save = screen.getByRole('button', { name: 'Save' })
    expect(date).toHaveAttribute('aria-invalid', 'true')
    expect(save).toBeDisabled()
    expect(save).toHaveAccessibleDescription(i18n.t('assets.uniform.catalog.validReceiptDate'))
    fireEvent.change(date, { target: { value: todayIso() } })
    expect(save).toBeEnabled()
  })

  it('preserves receipt values after a failed request', async () => {
    vi.mocked(api.createUniformReceipt).mockRejectedValue(new Error('offline'))
    mount('receipt')
    const user = userEvent.setup()
    const qty = await screen.findByRole('spinbutton', { name: 'Quantity of Polo shirt M' })
    fireEvent.change(qty, { target: { value: '3' } })
    await user.type(screen.getByLabelText('Reference'), 'HQ-42')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    expect(qty).toHaveValue(3)
    expect(screen.getByLabelText('Reference')).toHaveValue('HQ-42')
  })

  it('shows the translated empty state when no active shelf sizes can receive stock', async () => {
    vi.mocked(api.listUniformItems).mockResolvedValue([SUIT])
    mount('receipt')
    expect(await screen.findByText(i18n.t('assets.uniform.catalog.noReceiptSizes'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

describe('Uniform whole quantities', () => {
  it.each<[string, number]>([
    ['2.9', 2],
    ['-4', 0],
    ['', 0],
    ['not a number', 0],
    ['Infinity', 0],
    ['-Infinity', 0],
    ['1e100', Number.MAX_SAFE_INTEGER],
  ])('normalizes %s to %s', (raw, expected) => {
    expect(whole(raw)).toBe(expected)
  })
})
