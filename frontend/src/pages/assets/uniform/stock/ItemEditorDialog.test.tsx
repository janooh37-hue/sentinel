import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type UniformItemRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { UNIFORM_ART_KINDS } from '@/components/uniformArtCatalog'
import { uniformKeys } from '../uniformQueries'
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
  return { onOpenChange, onSuccess, client }
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
  vi.spyOn(api, 'removeUniformSize').mockResolvedValue(undefined)
  vi.spyOn(api, 'archiveUniformItem').mockResolvedValue({ ...ITEM, archived_at: '2026-11-04' })
  vi.spyOn(api, 'deleteUniformItem').mockResolvedValue(undefined)
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
    await waitFor(() => expect(api.createUniformAdjustments).toHaveBeenCalledWith(expect.objectContaining({ lines: [{ size_id: 21, delta, expected_on_hand: 8 }], reason: 'Physical count' })))
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
  it('allows holder metadata and drawing edits without shelf fields or adjustments', async () => {
    mount({ ...ITEM, tracking: 'holder', drawing: 'suit', sizes: [] })
    expect(await screen.findByRole('radio', { name: 'Suit' })).toHaveFocus()
    expect(screen.getByRole('spinbutton', { name: 'Hand-out default quantity' })).toHaveValue(2)
    expect(screen.queryByRole('textbox', { name: 'Add size' })).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'Formal shirt' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.updateUniformItem).toHaveBeenCalledWith(2, { drawing: 'dressshirt' }, '1'))
    expect(api.createUniformAdjustments).not.toHaveBeenCalled()
  })
  it('uses the saved metadata version for a new edit after a partial failure', async () => {
    vi.mocked(api.createUniformAdjustments).mockRejectedValueOnce(new ApiError(409, 'uniform_stale_count', 'Conflict')).mockResolvedValueOnce([])
    mount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'Formal shirt' }))
    fireEvent.change(screen.getByLabelText('Quantity of M'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Reason for adjustment'), { target: { value: 'Count' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    fireEvent.change(screen.getByLabelText('Name in English'), { target: { value: 'New shirt' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.updateUniformItem).toHaveBeenNthCalledWith(2, 2, { name_en: 'New shirt' }, '2'))
  })
  it('edits both names and descriptions, group and default quantity with the item version', async () => {
    mount()
    await screen.findByRole('radio', { name: 'Polo shirt' })
    const user = userEvent.setup()
    await user.clear(screen.getByLabelText('Name in English'))
    await user.type(screen.getByLabelText('Name in English'), '  Winter shirt  ')
    await user.clear(screen.getByLabelText('Name in Arabic'))
    await user.type(screen.getByLabelText('Name in Arabic'), '  قميص شتوي  ')
    await user.type(screen.getByLabelText('Description in English'), '  Warm fabric  ')
    await user.type(screen.getByLabelText('Description in Arabic'), '  قماش دافئ  ')
    await user.selectOptions(screen.getByLabelText('Group'), 'winter')
    fireEvent.change(screen.getByLabelText('Hand-out default quantity'), { target: { value: '3' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.updateUniformItem).toHaveBeenCalledWith(2, {
      name_en: 'Winter shirt', name_ar: 'قميص شتوي', description_en: 'Warm fabric', description_ar: 'قماش دافئ', group_key: 'winter', default_qty: 3,
    }, '1'))
  })
  it('validates required names and positive whole default quantities without writes', async () => {
    mount()
    await screen.findByRole('radio', { name: 'Polo shirt' })
    fireEvent.change(screen.getByLabelText('Name in English'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('Hand-out default quantity'), { target: { value: '1.5' } })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('This name is required.')).toBeInTheDocument()
    expect(screen.getByText('Enter a whole quantity of at least 1.')).toBeInTheDocument()
    expect(api.updateUniformItem).not.toHaveBeenCalled()
  })
  it('sends the draft baseline even after the catalogue refreshes and preserves a stale-count rejection', async () => {
    vi.mocked(api.createUniformAdjustments).mockRejectedValue(new ApiError(409, 'uniform_stale_count', 'Conflict'))
    const { client, onOpenChange } = mount()
    const input = await screen.findByRole('spinbutton', { name: 'Quantity of M' })
    await screen.findByRole('radio', { name: 'Polo shirt' })
    fireEvent.change(input, { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText('Reason for adjustment'), { target: { value: 'Physical count' } })
    act(() => client.setQueryData(uniformKeys.items(), [{ ...ITEM, sizes: [{ ...ITEM.sizes[0], on_hand: 12 }] }]))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.createUniformAdjustments).toHaveBeenCalledWith(expect.objectContaining({
      lines: [{ size_id: 21, delta: -2, expected_on_hand: 8 }],
    })))
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('assets.uniform.errors.staleCount'))
    expect(input).toHaveValue(6)
    expect(onOpenChange).not.toHaveBeenCalled()
  })
  it('reorders sizes and stages removal without writes until Save', async () => {
    const empty = { ...ITEM.sizes[0], on_hand: 0 }
    const second = { ...empty, id: 22, label: 'L', sort_order: 1 }
    mount({ ...ITEM, sizes: [empty, second] })
    await screen.findByRole('radio', { name: 'Polo shirt' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Move up: size L' }))
    expect(screen.getAllByRole('spinbutton', { name: /^Quantity of/ })[0]).toHaveAccessibleName('Quantity of L')
    await user.click(screen.getByRole('button', { name: 'Remove size M' }))
    expect(screen.queryByRole('spinbutton', { name: 'Quantity of M' })).not.toBeInTheDocument()
    expect(api.removeUniformSize).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.removeUniformSize).toHaveBeenCalledWith(21))
    expect(api.updateUniformSize).toHaveBeenCalledWith(22, { sort_order: 0 })
  })
  it('blocks removing sizes with stock or holdings and explains the restriction', async () => {
    mount({ ...ITEM, sizes: [ITEM.sizes[0], { ...ITEM.sizes[0], id: 22, label: 'L', on_hand: 0, held_qty: 1, sort_order: 1 }] })
    await screen.findByRole('radio', { name: 'Polo shirt' })
    for (const size of ['M', 'L']) {
      const remove = screen.getByRole('button', { name: `Remove size ${size}` })
      expect(remove).toBeDisabled()
      expect(remove).toHaveAccessibleDescription(i18n.t('assets.uniform.catalog.removeBlocked'))
    }
    expect(screen.getByRole('button', { name: 'Archive item' })).toBeDisabled()
    expect(api.removeUniformSize).not.toHaveBeenCalled()
  })
  it('retains completed adjustments and metadata when a later removal fails', async () => {
    vi.mocked(api.removeUniformSize).mockRejectedValueOnce(new ApiError(409, 'uniform_conflict', 'Conflict')).mockResolvedValueOnce(undefined)
    mount({ ...ITEM, sizes: [...ITEM.sizes, { ...ITEM.sizes[0], id: 22, label: 'L', on_hand: 0, sort_order: 1 }] })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'Formal shirt' }))
    await user.click(screen.getByRole('button', { name: 'Remove size L' }))
    fireEvent.change(screen.getByLabelText('Quantity of M'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Reason for adjustment'), { target: { value: 'Count' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.removeUniformSize).toHaveBeenCalledTimes(2))
    expect(api.updateUniformItem).toHaveBeenCalledTimes(1)
    expect(api.createUniformAdjustments).toHaveBeenCalledTimes(1)
  })
  it.each(['archive', 'delete'])('confirms %s and preserves a server rejection for retry', async action => {
    const mutation = action === 'archive' ? vi.mocked(api.archiveUniformItem) : vi.mocked(api.deleteUniformItem)
    mutation.mockRejectedValueOnce(new ApiError(409, 'uniform_conflict', 'Conflict'))
    const { onOpenChange } = mount({ ...ITEM, sizes: [{ ...ITEM.sizes[0], on_hand: 0 }] })
    await screen.findByRole('radio', { name: 'Polo shirt' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: action === 'archive' ? 'Archive item' : 'Delete item' }))
    expect(mutation).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: action === 'archive' ? 'Confirm archive' : 'Confirm delete' }))
    await screen.findByRole('alert')
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: action === 'archive' ? 'Confirm archive' : 'Confirm delete' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mutation).toHaveBeenNthCalledWith(1, 2)
    expect(mutation).toHaveBeenCalledTimes(2)
  })
  it('disables metadata, size and destructive controls while a save is pending', async () => {
    let finish!: (value: UniformItemRead) => void
    vi.mocked(api.updateUniformItem).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    mount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'Formal shirt' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.updateUniformItem).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText('Name in English')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete item' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    await act(async () => finish({ ...ITEM, version: '2' }))
  })
  it('does not mount the editor without edit capability', () => {
    state.editable = false
    mount()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

const RECEIPT = { id: 5, created_at: '2026-11-04T08:00:00', created_by_id: 1, voided_at: null, voided_by_id: null, void_reason: null, received_on: '2026-11-03', reference: 'HQ-20', note: 'Delivery', lines: [{ size_id: 21, qty: 4 }] }
const ADJUSTMENT = { id: 6, created_at: '2026-11-04T09:00:00', created_by_id: 1, voided_at: null, voided_by_id: null, void_reason: null, adjusted_on: '2026-11-04', size_id: 21, delta: -1, reason: 'Count correction' }
function mountStockSurface(surface: 'receive' | 'history' | 'stock', item = ITEM) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onOpenChange = vi.fn()
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}>
    {surface === 'receive' ? <ReceiveStockDialog open onOpenChange={onOpenChange} /> : surface === 'history' ? <StockHistory open item={item} onOpenChange={onOpenChange} /> : <StockTab onHandOut={vi.fn()} />}
  </I18nextProvider></QueryClientProvider>)
  return { onOpenChange, client }
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
  it('retains cached suit totals when the stock summary refresh fails', async () => {
    vi.mocked(api.getUniformSummary).mockResolvedValue({ shelf_total: 8, holder_count: 1, suits_issued: 3, out_of_stock: 0, low_sizes: 0 })
    const { client } = mountStockSurface('stock')
    const total = await screen.findByText('3 suits issued')
    vi.mocked(api.getUniformSummary).mockRejectedValueOnce(new Error('offline'))
    await act(async () => { await client.invalidateQueries({ queryKey: uniformKeys.summary }) })
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('assets.uniform.refreshRecordsError'))
    expect(screen.getByText('3 suits issued')).toBe(total)
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByText('3 suits issued')).toBe(total)
  })
  it.each(['add', 'edit', 'receive', 'history'] as const)('keeps the %s dialog and its draft mounted through StockTab catalogue refresh failure and retry', async kind => {
    const { client } = mountStockSurface('stock')
    const user = userEvent.setup()
    const updates = await screen.findAllByRole('button', { name: 'Update' })
    if (kind === 'add') await user.click(screen.getByRole('button', { name: 'Add item' }))
    else if (kind === 'edit') await user.click(updates[0])
    else if (kind === 'receive') await user.click(screen.getByRole('button', { name: 'Receive stock' }))
    else await user.click(screen.getAllByRole('button', { name: 'Stock history' })[0])
    const dialog = await screen.findByRole('dialog')
    const content = within(dialog)
    let input: HTMLElement
    let assertDraft: () => void
    if (kind === 'add' || kind === 'edit') {
      input = await content.findByLabelText('Name in English')
      await user.clear(input)
      await user.type(input, 'Field shirt')
      const arabic = content.getByLabelText('Name in Arabic')
      await user.clear(arabic)
      await user.type(arabic, 'قميص ميداني')
      await user.selectOptions(content.getByLabelText('Group'), 'guard')
      await user.type(content.getByLabelText('Add size'), 'Tall{Enter}')
      if (kind === 'edit') {
        fireEvent.change(content.getByRole('spinbutton', { name: 'Quantity of M' }), { target: { value: '6' } })
        await user.type(content.getByLabelText('Reason for adjustment'), 'Physical count')
      }
      const drawing = content.getByRole('radio', { name: 'Formal shirt' })
      await user.click(drawing)
      assertDraft = () => {
        expect(content.getByLabelText('Name in English')).toBe(input)
        expect(input).toHaveValue('Field shirt')
        expect(content.getByLabelText('Name in Arabic')).toBe(arabic)
        expect(arabic).toHaveValue('قميص ميداني')
        expect(content.getByRole('button', { name: 'Remove size Tall' })).toBeInTheDocument()
        expect(content.getByRole('radio', { name: 'Formal shirt' })).toBe(drawing)
        expect(drawing).toBeChecked()
        if (kind === 'edit') {
          expect(content.getByRole('spinbutton', { name: 'Quantity of M' })).toHaveValue(6)
          expect(content.getByLabelText('Reason for adjustment')).toHaveValue('Physical count')
        }
        expect(content.getByRole('button', { name: 'Save' })).toBeEnabled()
      }
    } else if (kind === 'receive') {
      input = await content.findByRole('spinbutton', { name: 'Quantity of Polo shirt M' })
      fireEvent.change(input, { target: { value: '5' } })
      await user.type(content.getByLabelText('Reference'), 'HQ-42')
      await user.type(content.getByLabelText('Note'), 'Delivery draft')
      fireEvent.change(content.getByLabelText('Receipt date'), { target: { value: '2026-01-02' } })
      assertDraft = () => {
        expect(content.getByRole('spinbutton', { name: 'Quantity of Polo shirt M' })).toBe(input)
        expect(input).toHaveValue(5)
        expect(content.getByLabelText('Reference')).toHaveValue('HQ-42')
        expect(content.getByLabelText('Note')).toHaveValue('Delivery draft')
        expect(content.getByLabelText('Receipt date')).toHaveValue('2026-01-02')
        expect(content.getByRole('button', { name: 'Save' })).toBeEnabled()
      }
    } else {
      await content.findByText('Count correction')
      await user.click(content.getAllByRole('button', { name: 'Void record' })[0])
      input = content.getByRole('textbox', { name: 'Reason for voiding' })
      await user.type(input, 'Correction draft')
      assertDraft = () => {
        expect(content.getByRole('textbox', { name: 'Reason for voiding' })).toBe(input)
        expect(input).toHaveValue('Correction draft')
        expect(content.getByText('HQ-20')).toBeVisible()
        expect(content.getByText('Count correction')).toBeVisible()
      }
    }
    vi.mocked(api.listUniformItems).mockRejectedValue(new Error('offline'))
    await act(async () => { await client.invalidateQueries({ queryKey: uniformKeys.all }) })
    expect(await screen.findByRole('dialog')).toBe(dialog)
    expect(content.getAllByRole('alert').length).toBeGreaterThan(0)
    assertDraft()
    vi.mocked(api.listUniformItems).mockResolvedValue([ITEM, { ...ITEM, id: 3, drawing: 'boots', sizes: [] }])
    await user.click(content.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(content.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('dialog')).toBe(dialog)
    assertDraft()
  })

  it.each(['receipts', 'adjustments'] as const)('keeps an inline void draft while cached %s fail to refresh', async resource => {
    const { client } = mountStockSurface('history')
    await screen.findByText('Count correction')
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: 'Void record' })[0])
    const input = screen.getByRole('textbox', { name: 'Reason for voiding' })
    await user.type(input, 'Correction draft')
    if (resource === 'receipts') vi.mocked(api.listUniformReceipts).mockRejectedValueOnce(new Error('offline'))
    else vi.mocked(api.listUniformAdjustments).mockRejectedValueOnce(new Error('offline'))
    const queryKey = resource === 'receipts' ? uniformKeys.receipts : uniformKeys.adjustments
    await act(async () => { await client.invalidateQueries({ queryKey }) })
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('assets.uniform.refreshRecordsError'))
    expect(screen.getByRole('textbox', { name: 'Reason for voiding' })).toBe(input)
    expect(input).toHaveValue('Correction draft')
    expect(screen.getByText('HQ-20')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: 'Reason for voiding' })).toBe(input)
    expect(input).toHaveValue('Correction draft')
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
  it('shows every affected receipt item before and during whole-receipt void confirmation', async () => {
    const boots: UniformItemRead = { ...ITEM, id: 3, name_en: 'Boots', name_ar: 'حذاء', drawing: 'boots', archived_at: '2026-10-01', sizes: [{ ...ITEM.sizes[0], id: 31, item_id: 3, label: '42', on_hand: 0 }] }
    const receipt = { ...RECEIPT, lines: [{ size_id: 21, qty: 4 }, { size_id: 31, qty: 2 }] }
    vi.mocked(api.listUniformItems).mockImplementation(async includeArchived => includeArchived ? [ITEM, boots] : [ITEM])
    vi.mocked(api.listUniformReceipts).mockResolvedValue([receipt])
    mountStockSurface('history')
    const reference = await screen.findByText('HQ-20')
    const entry = reference.closest('li')!
    expect(api.listUniformItems).toHaveBeenCalledWith(true)
    const expectAllLines = () => {
      const poloLine = within(entry).getByText('Polo shirt').closest('li')!
      expect(within(poloLine).getByText('M')).toBeVisible()
      expect(within(poloLine).getByText('4')).toBeVisible()
      const bootsLine = within(entry).getByText('Boots').closest('li')!
      expect(within(bootsLine).getByText('42')).toBeVisible()
      expect(within(bootsLine).getByText('2')).toBeVisible()
    }
    expectAllLines()
    const user = userEvent.setup()
    await user.click(within(entry).getByRole('button', { name: 'Void record' }))
    expectAllLines()
    expect(within(entry).getByText(i18n.t('assets.uniform.catalog.voidEntireReceipt'))).toBeVisible()
    await user.type(within(entry).getByRole('textbox', { name: 'Reason for voiding' }), 'Wrong receipt')
    await user.click(within(entry).getByRole('button', { name: 'Void record' }))
    await waitFor(() => expect(api.voidUniformReceipt).toHaveBeenCalledWith(5, { reason: 'Wrong receipt' }))
  })
  it.each(['en', 'ar'])('retains receipts and adjustments for the last removed size using the history catalogue in %s', async language => {
    await i18n.changeLanguage(language)
    const historyItem = { ...ITEM, sizes: [{ ...ITEM.sizes[0], on_hand: 0, archived_at: '2026-11-04T10:00:00Z' }] }
    vi.mocked(api.listUniformItems).mockImplementation(async includeArchived => includeArchived ? [historyItem] : [{ ...ITEM, sizes: [] }])
    mountStockSurface('history', { ...ITEM, sizes: [] })
    const receipt = (await screen.findByText('HQ-20')).closest('li')!
    expect(within(receipt).getByText('M')).toBeVisible()
    expect(within(receipt).getByText('4')).toBeVisible()
    const adjustment = screen.getByText('Count correction').closest('li')!
    expect(within(adjustment).getByText('M')).toBeVisible()
    expect(within(adjustment).getByText('-1')).toBeVisible()
    expect(screen.queryByText(i18n.t('assets.uniform.catalog.historyEmpty'))).not.toBeInTheDocument()
    expect(api.listUniformItems).toHaveBeenCalledWith(true)
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
