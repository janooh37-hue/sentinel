import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type UniformItemRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { UNIFORM_ART_KINDS } from '@/components/uniformArtCatalog'
import { ItemEditorDialog } from './ItemEditorDialog'

import { ReceiveStockDialog } from './ReceiveStockDialog'
import { StockHistory } from './StockHistory'
import { StockTab } from './StockTab'
const state = vi.hoisted(() => ({ editable: true }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => state.editable }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }))

const ITEM: UniformItemRead = { id: 2, name_en: 'Polo shirt', name_ar: 'قميص بولو', description_en: null, description_ar: null, group_key: 'guard', drawing: 'polo', tracking: 'shelf', default_qty: 2, sort_order: 0, archived_at: null, version: '1', holders: [], sizes: [
  { id: 21, item_id: 2, label: 'M', on_hand: 8, min_qty: null, is_low: false, held_qty: 0, archived_at: null, sort_order: 0 },
] }
function mount(item = ITEM) {
  const onOpenChange = vi.fn()
  const onSuccess = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><ItemEditorDialog open item={item} onOpenChange={onOpenChange} onSuccess={onSuccess} /></I18nextProvider></QueryClientProvider>)
  return { onOpenChange, onSuccess }
}
beforeEach(async () => {
  vi.restoreAllMocks()
  state.editable = true
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listUniformItems').mockResolvedValue([ITEM, { ...ITEM, id: 3, drawing: 'boots', sizes: [] }])
  vi.spyOn(api, 'updateUniformItem').mockResolvedValue({ ...ITEM, version: '2' })
  vi.spyOn(api, 'addUniformSize').mockResolvedValue({ ...ITEM.sizes[0], id: 25, label: '4XL', on_hand: 0 })
  vi.spyOn(api, 'updateUniformSize').mockResolvedValue(ITEM.sizes[0])
  vi.spyOn(api, 'createUniformAdjustments').mockResolvedValue([])
})
describe('Update uniform item', () => {
  it('offers its own drawing plus unused drawings and retains its selection', async () => {
    mount()
    expect(await screen.findByRole('radio', { name: 'Polo shirt' })).toBeChecked()
    expect(screen.queryByRole('radio', { name: 'Boots' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(11)
  })
  it('still allows its own drawing when every drawing is occupied', async () => {
    vi.mocked(api.listUniformItems).mockResolvedValue(UNIFORM_ART_KINDS.map((drawing, index) => ({ ...ITEM, id: drawing === ITEM.drawing ? ITEM.id : index + 100, drawing })))
    mount()
    expect(await screen.findByRole('radio', { name: 'Polo shirt' })).toBeChecked()
    expect(screen.getAllByRole('radio')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
  it('stages a trimmed size with Enter, rejects case-insensitive duplicates and cancels without writes', async () => {
    const { onOpenChange } = mount()
    const user = userEvent.setup()
    const field = await screen.findByRole('textbox', { name: 'Add size' })
    await user.type(field, ' 4XL {Enter}')
    expect(screen.getByRole('spinbutton', { name: 'Quantity of 4XL' })).toHaveValue(0)
    expect(api.addUniformSize).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.type(field, '4xl{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('This size already exists.')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.addUniformSize).not.toHaveBeenCalled()
  })
  it.each([['-5', 0, -8], ['2.7', 2, -6]])('floors and clamps %s on commit and posts the difference only with a reason', async (raw, expected, delta) => {
    mount()
    const input = await screen.findByRole('spinbutton', { name: 'Quantity of M' })
    fireEvent.change(input, { target: { value: raw } })
    fireEvent.blur(input)
    expect(input).toHaveValue(expected)
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    expect(save).toHaveAccessibleDescription('Enter a reason for the stock adjustment.')
    fireEvent.submit(save.closest('form')!)
    expect(api.createUniformAdjustments).not.toHaveBeenCalled()
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Reason for adjustment' }), 'Physical count')
    await user.click(save)
    await waitFor(() => expect(api.createUniformAdjustments).toHaveBeenCalledWith(expect.objectContaining({ lines: [{ size_id: 21, delta }], reason: 'Physical count' })))
  })
  it('persists staged sizes at zero and optional per-size alert thresholds on Save', async () => {
    mount()
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox', { name: 'Add size' }), '4XL{Enter}')
    const threshold = screen.getByRole('spinbutton', { name: 'Alert at M' })
    fireEvent.change(threshold, { target: { value: '-2.5' } })
    fireEvent.blur(threshold)
    expect(threshold).toHaveValue(0)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.addUniformSize).toHaveBeenCalledWith(2, { label: '4XL', min_qty: null }))
    expect(api.updateUniformSize).toHaveBeenCalledWith(21, { min_qty: 0 })
    expect(api.createUniformAdjustments).not.toHaveBeenCalled()
  })
  it('keeps the drawing conflict inline and preserves the form', async () => {
    vi.mocked(api.updateUniformItem).mockRejectedValue(new ApiError(409, 'uniform_drawing_in_use', 'Conflict'))
    const { onOpenChange } = mount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'Formal shirt' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Another active item already uses this drawing. Choose another drawing.')
    expect(onOpenChange).not.toHaveBeenCalled()
  })
  it('uses the latest version after a partially saved update, without duplicating a staged size', async () => {
    vi.mocked(api.createUniformAdjustments).mockRejectedValueOnce(new ApiError(409, 'uniform_insufficient_stock', 'Conflict')).mockResolvedValueOnce([])
    mount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'Formal shirt' }))
    await user.type(screen.getByRole('textbox', { name: 'Add size' }), '4XL{Enter}')
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity of M' }), { target: { value: '7' } })
    await user.type(screen.getByRole('textbox', { name: 'Reason for adjustment' }), 'Count')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.createUniformAdjustments).toHaveBeenCalledTimes(2))
    expect(api.addUniformSize).toHaveBeenCalledTimes(1)
    expect(api.updateUniformItem).toHaveBeenCalledTimes(1)
  })
  it('offers only a drawing for a holder item and never adds shelf fields or adjustments', async () => {
    mount({ ...ITEM, tracking: 'holder', drawing: 'suit', sizes: [] })
    expect(await screen.findByRole('radio', { name: 'Suit' })).toHaveFocus()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Add size' })).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'Formal shirt' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.updateUniformItem).toHaveBeenCalledWith(2, { drawing: 'dressshirt' }, '1'))
    expect(api.createUniformAdjustments).not.toHaveBeenCalled()
  })
  it('does not mount the editor without edit capability', () => {
    state.editable = false
    mount()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

const RECEIPT = { id: 5, created_at: '2026-11-04T08:00:00', created_by_id: 1, voided_at: null, voided_by_id: null, void_reason: null, received_on: '2026-11-03', reference: 'HQ-20', note: 'Delivery', lines: [{ size_id: 21, qty: 4 }] }
const ADJUSTMENT = { id: 6, created_at: '2026-11-04T09:00:00', created_by_id: 1, voided_at: null, voided_by_id: null, void_reason: null, adjusted_on: '2026-11-04', size_id: 21, delta: -1, reason: 'Count correction' }
function mountStockSurface(surface: 'receive' | 'history' | 'stock') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onOpenChange = vi.fn()
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}>
    {surface === 'receive' ? <ReceiveStockDialog open onOpenChange={onOpenChange} /> : surface === 'history' ? <StockHistory open item={ITEM} onOpenChange={onOpenChange} /> : <StockTab onHandOut={vi.fn()} />}
  </I18nextProvider></QueryClientProvider>)
  return { onOpenChange }
}

describe('Receive stock and inspect posting history', () => {
  beforeEach(() => {
    vi.spyOn(api, 'createUniformReceipt').mockResolvedValue(RECEIPT)
    vi.spyOn(api, 'listUniformReceipts').mockResolvedValue([RECEIPT])
    vi.spyOn(api, 'listUniformAdjustments').mockResolvedValue([ADJUSTMENT])
    vi.spyOn(api, 'getUniformSummary').mockResolvedValue({ shelf_total: 8, holder_count: 0, suits_issued: 0, out_of_stock: 0, low_sizes: 0 })
    vi.spyOn(api, 'voidUniformReceipt').mockResolvedValue({ ...RECEIPT, void_reason: 'Wrong delivery', voided_at: '2026-11-04T12:00:00' })
    vi.spyOn(api, 'voidUniformAdjustment').mockResolvedValue({ ...ADJUSTMENT, void_reason: 'Wrong count', voided_at: '2026-11-04T12:00:00' })
  })
  it('requires positive received quantities, normalizes them and posts a dated receipt', async () => {
    const { onOpenChange } = mountStockSurface('receive')
    const input = await screen.findByRole('spinbutton', { name: 'Quantity of Polo shirt M' })
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    fireEvent.change(input, { target: { value: '-3' } })
    fireEvent.blur(input)
    expect(input).toHaveValue(0)
    fireEvent.change(input, { target: { value: '4.8' } })
    fireEvent.blur(input)
    expect(input).toHaveValue(4)
    fireEvent.change(screen.getByLabelText('Receipt date'), { target: { value: '2026-01-02' } })
    fireEvent.change(screen.getByLabelText('Reference'), { target: { value: '  HQ-20  ' } })
    await userEvent.setup().click(save)
    await waitFor(() => expect(api.createUniformReceipt).toHaveBeenCalledWith({ received_on: '2026-01-02', reference: 'HQ-20', note: null, lines: [{ size_id: 21, qty: 4 }] }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
  it('blocks a future receipt date with an accessible reason and retains failed receipt quantities', async () => {
    vi.mocked(api.createUniformReceipt).mockRejectedValue(new ApiError(409, 'uniform_insufficient_stock', 'Conflict'))
    mountStockSurface('receive')
    const input = await screen.findByRole('spinbutton', { name: 'Quantity of Polo shirt M' })
    fireEvent.change(input, { target: { value: '2' } })
    const date = screen.getByLabelText('Receipt date')
    fireEvent.change(date, { target: { value: '2999-01-01' } })
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    expect(save).toHaveAccessibleDescription('Choose a valid receipt date that is not in the future.')
    fireEvent.submit(save.closest('form')!)
    expect(api.createUniformReceipt).not.toHaveBeenCalled()
    fireEvent.change(date, { target: { value: '2026-01-02' } })
    await userEvent.setup().click(save)
    expect(await screen.findByRole('alert')).toHaveTextContent('Not enough stock on the shelf.')
    expect(input).toHaveValue(2)
  })
  it('lists receipts and adjustments newest first, requires a void reason and preserves a rejected void', async () => {
    vi.mocked(api.voidUniformAdjustment).mockRejectedValueOnce(new ApiError(409, 'uniform_insufficient_stock', 'Conflict'))
    mountStockSurface('history')
    const correction = await screen.findByText('Count correction')
    expect(screen.getAllByRole('listitem')[0]).toContainElement(correction)
    expect(screen.getByText('HQ-20')).toHaveAttribute('dir', 'auto')
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: 'Void record' })[0])
    const reason = screen.getByRole('textbox', { name: 'Reason for voiding' })
    const confirm = screen.getAllByRole('button', { name: 'Void record' })[0]
    expect(confirm).toBeDisabled()
    await user.type(reason, '   ')
    expect(confirm).toBeDisabled()
    await user.type(reason, 'Wrong count  ')
    await user.click(confirm)
    await screen.findByRole('alert')
    expect(reason).toHaveValue('   Wrong count  ')
    await user.click(confirm)
    await waitFor(() => expect(api.voidUniformAdjustment).toHaveBeenLastCalledWith(6, { reason: 'Wrong count' }))
  })
  it('permits readonly history but hides every Void action', async () => {
    state.editable = false
    mountStockSurface('history')
    await screen.findByText('HQ-20')
    expect(screen.queryByRole('button', { name: 'Void record' })).not.toBeInTheDocument()
  })
  it('opens catalogue actions from Stock and restores focus to the opener', async () => {
    mountStockSurface('stock')
    const user = userEvent.setup()
    const update = await screen.findAllByRole('button', { name: 'Update' })
    await user.click(update[0])
    await screen.findByRole('dialog', { name: 'Edit item' })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(update[0]).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Add item' }))
    expect(await screen.findByRole('dialog', { name: 'Add item' })).toBeInTheDocument()
  })
})
