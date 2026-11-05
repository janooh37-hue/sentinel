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
  it.each(['uniform_size_not_found', 'uniform_size_archived'])('reconciles %s without a metadata write and preserves staged sizes', async code => {
    const user = userEvent.setup()
    vi.mocked(api.updateUniformSize).mockRejectedValueOnce(new ApiError(404, code, 'Size unavailable'))
    const { onOpenChange } = mount({ ...ITEM, sizes: [{ ...ITEM.sizes[0], on_hand: 0 }] })
    await screen.findByRole('radio', { name: 'Polo shirt' })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Alert at M' }), { target: { value: '2' } })
    await user.type(screen.getByLabelText('Add size'), 'Tall{Enter}')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('button', { name: 'Review latest version' })
    vi.mocked(api.listUniformItems).mockResolvedValue([{ ...ITEM, sizes: [] }])
    await user.click(screen.getByRole('button', { name: 'Review latest version' }))
    await user.click(await screen.findByRole('button', { name: 'Keep my changes and continue editing' }))
    expect(screen.getByRole('spinbutton', { name: 'Alert at M' })).toHaveValue(2)
    expect(screen.getByRole('spinbutton', { name: 'Quantity of Tall' })).toHaveValue(0)
    await user.click(screen.getByRole('button', { name: 'Remove size M' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(api.updateUniformItem).not.toHaveBeenCalled()
    expect(api.removeUniformSize).not.toHaveBeenCalled()
    expect(api.updateUniformSize).toHaveBeenCalledTimes(1)
    expect(api.addUniformSize).toHaveBeenCalledWith(2, { label: 'Tall', min_qty: null })
  })
  it.each(['remove', 'recreate'] as const)('recovers a concurrently removed size by explicit %s without losing metadata', async choice => {
    const user = userEvent.setup()
    const empty = { ...ITEM, sizes: [{ ...ITEM.sizes[0], on_hand: 0 }] }
    vi.mocked(api.updateUniformItem).mockRejectedValueOnce(new ApiError(412, 'precondition_failed', 'Conflict'))
    const { onOpenChange } = mount(empty)
    await screen.findByRole('radio', { name: 'Polo shirt' })
    fireEvent.change(screen.getByLabelText('Name in English'), { target: { value: 'My polo' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Alert at M' }), { target: { value: '2' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('button', { name: 'Review latest version' })
    vi.mocked(api.listUniformItems).mockResolvedValue([{ ...ITEM, version: '2', sizes: [] }])
    await user.click(screen.getByRole('button', { name: 'Review latest version' }))
    await user.click(await screen.findByRole('button', { name: 'Keep my changes and continue editing' }))
    expect(screen.getByLabelText('Name in English')).toHaveValue('My polo')
    expect(screen.getByRole('spinbutton', { name: 'Alert at M' })).toHaveValue(2)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: choice === 'remove' ? 'Remove size M' : 'Recreate size M' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(api.updateUniformItem).toHaveBeenLastCalledWith(2, { name_en: 'My polo' }, '2')
    expect(api.removeUniformSize).not.toHaveBeenCalled()
    expect(api.updateUniformSize).not.toHaveBeenCalled()
    if (choice === 'recreate') expect(api.addUniformSize).toHaveBeenCalledWith(2, { label: 'M', min_qty: 2 })
    else expect(api.addUniformSize).not.toHaveBeenCalled()
  })
  it('reconciles stale stock counts without recreating a committed size or losing the count draft', async () => {
    const user = userEvent.setup()
    const added = { ...ITEM.sizes[0], id: 25, label: 'Tall', on_hand: 0, sort_order: 1 }
    vi.mocked(api.addUniformSize).mockResolvedValue(added)
    vi.mocked(api.createUniformAdjustments).mockRejectedValueOnce(new ApiError(409, 'uniform_stale_count', 'Count changed'))
    const { onOpenChange } = mount()
    await screen.findByRole('radio', { name: 'Polo shirt' })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity of M' }), { target: { value: '6' } })
    await user.type(screen.getByLabelText('Reason for adjustment'), 'Physical count')
    await user.type(screen.getByLabelText('Add size'), 'Tall{Enter}')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.createUniformAdjustments).toHaveBeenCalledTimes(1))
    expect(api.addUniformSize).toHaveBeenCalledTimes(1)
    vi.mocked(api.listUniformItems).mockResolvedValue([{ ...ITEM, version: '3', sizes: [{ ...ITEM.sizes[0], on_hand: 12 }, added] }])
    await user.click(screen.getByRole('button', { name: 'Review latest version' }))
    await screen.findByText('12')
    await user.click(screen.getByRole('button', { name: 'Keep my changes and continue editing' }))
    expect(screen.getByRole('spinbutton', { name: 'Quantity of M' })).toHaveValue(6)
    expect(screen.getByLabelText('Reason for adjustment')).toHaveValue('Physical count')
    expect(screen.getByRole('spinbutton', { name: 'Quantity of Tall' })).toHaveValue(0)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(api.addUniformSize).toHaveBeenCalledTimes(1)
    expect(api.createUniformAdjustments).toHaveBeenLastCalledWith(expect.objectContaining({
      lines: [{ size_id: 21, delta: -6, expected_on_hand: 12 }],
      reason: 'Physical count',
    }))
  })
  it.each([false, true])('recovers metadata and threshold conflicts while preserving drafts (edited threshold: %s)', async editedThreshold => {
    const user = userEvent.setup()
    const latest = { ...ITEM, description_en: 'Concurrent description', version: '2', sizes: [{ ...ITEM.sizes[0], min_qty: 2 }] }
    vi.mocked(api.updateUniformItem).mockRejectedValueOnce(new ApiError(412, 'precondition_failed', 'Conflict'))
    const { onOpenChange } = mount()
    await screen.findByRole('radio', { name: 'Polo shirt' })
    await user.clear(screen.getByLabelText('Name in English'))
    await user.type(screen.getByLabelText('Name in English'), 'My polo')
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity of M' }), { target: { value: '9' } })
    if (editedThreshold) fireEvent.change(screen.getByRole('spinbutton', { name: 'Alert at M' }), { target: { value: '3' } })
    await user.type(screen.getByLabelText('Reason for adjustment'), 'Found one')
    await user.type(screen.getByLabelText('Add size'), 'Tall{Enter}')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.updateUniformItem).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    vi.mocked(api.listUniformItems).mockResolvedValue([latest])
    await user.click(screen.getByRole('button', { name: 'Review latest version' }))
    await screen.findByText('Concurrent description')
    expect(api.updateUniformItem).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Keep my changes and continue editing' }))
    expect(screen.getByLabelText('Name in English')).toHaveValue('My polo')
    expect(screen.getByRole('spinbutton', { name: 'Quantity of M' })).toHaveValue(9)
    expect(screen.getByLabelText('Reason for adjustment')).toHaveValue('Found one')
    expect(screen.getByRole('spinbutton', { name: 'Quantity of Tall' })).toHaveValue(0)
    expect(screen.getByRole('spinbutton', { name: 'Alert at M' })).toHaveValue(editedThreshold ? 3 : 2)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Alert at M' }), { target: { value: '' } })
    vi.mocked(api.updateUniformItem).mockResolvedValue({ ...latest, name_en: 'My polo', version: '3' })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(api.updateUniformItem).toHaveBeenLastCalledWith(2, { name_en: 'My polo' }, '2')
    expect(api.addUniformSize).toHaveBeenCalledWith(2, { label: 'Tall', min_qty: null })
    expect(api.updateUniformSize).toHaveBeenCalledWith(21, { min_qty: null })
    expect(api.createUniformAdjustments).toHaveBeenCalledWith(expect.objectContaining({
      lines: [{ size_id: 21, delta: 1, expected_on_hand: 8 }],
      reason: 'Found one',
    }))
  })
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
  it('restores a removed staged size case-insensitively with its quantity, threshold and reason', async () => {
    vi.mocked(api.addUniformSize).mockResolvedValue({ ...ITEM.sizes[0], id: 25, label: 'Tall', on_hand: 0, min_qty: 2, sort_order: 1 })
    mount()
    const user = userEvent.setup()
    const field = await screen.findByLabelText('Add size')
    await user.type(field, 'Tall{Enter}')
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity of Tall' }), { target: { value: '3' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Alert at Tall' }), { target: { value: '2' } })
    await user.type(screen.getByLabelText('Reason for adjustment'), 'Found stock')
    await user.click(screen.getByRole('button', { name: 'Remove size Tall' }))
    expect(screen.queryByRole('spinbutton', { name: 'Quantity of Tall' })).not.toBeInTheDocument()
    await user.type(field, ' tall {Enter}')
    expect(screen.getByRole('spinbutton', { name: 'Quantity of Tall' })).toHaveValue(3)
    expect(screen.getByRole('spinbutton', { name: 'Alert at Tall' })).toHaveValue(2)
    expect(screen.getByLabelText('Reason for adjustment')).toHaveValue('Found stock')
    await user.type(field, 'TALL{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('assets.uniform.sizeDuplicate'))
    expect(api.addUniformSize).not.toHaveBeenCalled()
    await user.clear(field)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.addUniformSize).toHaveBeenCalledTimes(1))
    expect(api.addUniformSize).toHaveBeenCalledWith(2, { label: 'Tall', min_qty: 2 })
    expect(api.createUniformAdjustments).toHaveBeenCalledWith(expect.objectContaining({
      lines: [{ size_id: 25, delta: 3, expected_on_hand: 0 }],
    }))
    expect(api.removeUniformSize).not.toHaveBeenCalled()
  })
  it.each(['M', 'one'])('restores an existing removed %s size without deleting or recreating its identity', async label => {
    mount({ ...ITEM, sizes: [{ ...ITEM.sizes[0], label, on_hand: 0 }] })
    const user = userEvent.setup()
    await screen.findByRole('radio', { name: 'Polo shirt' })
    const display = label === 'one' ? 'One size' : label
    await user.click(screen.getByRole('button', { name: `Remove size ${display}` }))
    await user.type(screen.getByLabelText('Add size'), `${label.toUpperCase()}{Enter}`)
    expect(screen.getByRole('spinbutton', { name: `Quantity of ${display}` })).toHaveValue(0)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    expect(api.addUniformSize).not.toHaveBeenCalled()
    expect(api.removeUniformSize).not.toHaveBeenCalled()
    expect(api.createUniformAdjustments).not.toHaveBeenCalled()
  })
  it('stages pending size text before validating metadata and requires a second Save', async () => {
    const { onOpenChange } = mount()
    const user = userEvent.setup()
    await screen.findByRole('radio', { name: 'Polo shirt' })
    fireEvent.change(screen.getByLabelText('Name in English'), { target: { value: '' } })
    await user.type(screen.getByLabelText('Add size'), '  Tall  ')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('spinbutton', { name: 'Quantity of Tall' })).toHaveValue(0)
    expect(screen.getByLabelText('Add size')).toHaveValue('')
    expect(api.updateUniformItem).not.toHaveBeenCalled()
    expect(api.addUniformSize).not.toHaveBeenCalled()
    expect(api.updateUniformSize).not.toHaveBeenCalled()
    expect(api.removeUniformSize).not.toHaveBeenCalled()
    expect(api.createUniformAdjustments).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('This name is required.')).toBeInTheDocument()
    expect(api.addUniformSize).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Name in English'), { target: { value: ITEM.name_en } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(api.addUniformSize).toHaveBeenCalledTimes(1)
    expect(api.addUniformSize).toHaveBeenCalledWith(2, { label: 'Tall', min_qty: null })
  })
  it.each(['en', 'ar'])('announces pending size review without saving in %s', async language => {
    await i18n.changeLanguage(language)
    const { onOpenChange } = mount()
    const user = userEvent.setup()
    const save = screen.getByRole('button', { name: i18n.t('assets.uniform.save') })
    await waitFor(() => expect(save).toBeEnabled())
    const field = screen.getByLabelText(i18n.t('assets.uniform.addSize'))
    for (const label of ['Tall', 'Wide']) {
      await user.type(field, label)
      expect(screen.getByRole('status')).not.toHaveTextContent(i18n.t('assets.uniform.sizeStaged'))
      await user.click(save)
      expect(screen.getByRole('status')).toHaveTextContent(i18n.t('assets.uniform.sizeStaged'))
    }
    expect(api.addUniformSize).not.toHaveBeenCalled()
    expect(api.updateUniformItem).not.toHaveBeenCalled()
    expect(api.createUniformAdjustments).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
  it.each([
    [' m ', 'assets.uniform.sizeDuplicate'],
    ['abcdefghijklmnopq', 'assets.uniform.errors.invalidSizeLabel'],
    [' ONE ', 'assets.uniform.errors.sizesFixed'],
  ])('preserves invalid pending %j and blocks all writes until corrected and reviewed', async (pending, key) => {
    const { onOpenChange } = mount()
    const user = userEvent.setup()
    const field = await screen.findByLabelText('Add size')
    await screen.findByRole('radio', { name: 'Polo shirt' })
    fireEvent.change(screen.getByLabelText('Name in English'), { target: { value: 'Changed shirt' } })
    fireEvent.change(field, { target: { value: pending } })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(screen.getByRole('alert')).toHaveTextContent(i18n.t(key))
      expect(field).toHaveValue(pending)
      expect(field).toHaveAttribute('aria-invalid', 'true')
      expect(api.updateUniformItem).not.toHaveBeenCalled()
      expect(api.addUniformSize).not.toHaveBeenCalled()
      expect(api.updateUniformSize).not.toHaveBeenCalled()
      expect(api.removeUniformSize).not.toHaveBeenCalled()
      expect(api.createUniformAdjustments).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalled()
    }
    fireEvent.change(field, { target: { value: ' Tall ' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('spinbutton', { name: 'Quantity of Tall' })).toHaveValue(0)
    expect(api.updateUniformItem).not.toHaveBeenCalled()
    expect(api.addUniformSize).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(api.updateUniformItem).toHaveBeenCalledTimes(1)
    expect(api.addUniformSize).toHaveBeenCalledTimes(1)
  })
  it('reviews a pending restoration before saving its original quantity and threshold', async () => {
    const { onOpenChange } = mount({ ...ITEM, sizes: [{ ...ITEM.sizes[0], on_hand: 0, min_qty: 2 }] })
    const user = userEvent.setup()
    await screen.findByRole('radio', { name: 'Polo shirt' })
    fireEvent.change(screen.getByLabelText('Quantity of M'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Reason for adjustment'), { target: { value: 'Found stock' } })
    await user.click(screen.getByRole('button', { name: 'Remove size M' }))
    await user.type(screen.getByLabelText('Add size'), ' m ')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByLabelText('Quantity of M')).toHaveValue(3)
    expect(screen.getByLabelText('Alert at M')).toHaveValue(2)
    expect(screen.getByLabelText('Reason for adjustment')).toHaveValue('Found stock')
    expect(api.removeUniformSize).not.toHaveBeenCalled()
    expect(api.addUniformSize).not.toHaveBeenCalled()
    expect(api.createUniformAdjustments).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(api.createUniformAdjustments).toHaveBeenCalledWith(expect.objectContaining({
      lines: [{ size_id: 21, delta: 3, expected_on_hand: 0 }], reason: 'Found stock',
    }))
    expect(api.addUniformSize).not.toHaveBeenCalled()
    expect(api.removeUniformSize).not.toHaveBeenCalled()
  })
  it('reviews pending text even when an unrelated quantity still needs its adjustment reason', async () => {
    const { onOpenChange } = mount()
    const user = userEvent.setup()
    await screen.findByRole('radio', { name: 'Polo shirt' })
    fireEvent.change(screen.getByLabelText('Quantity of M'), { target: { value: '7' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.type(screen.getByLabelText('Add size'), 'Tall')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByLabelText('Quantity of Tall')).toHaveValue(0)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(api.addUniformSize).not.toHaveBeenCalled()
    expect(api.createUniformAdjustments).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Reason for adjustment'), 'Count')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(api.addUniformSize).toHaveBeenCalledTimes(1)
    expect(api.createUniformAdjustments).toHaveBeenCalledTimes(1)
  })
  it('ignores whitespace-only pending text without creating a size', async () => {
    const { onOpenChange } = mount()
    const user = userEvent.setup()
    await screen.findByRole('radio', { name: 'Polo shirt' })
    await user.type(screen.getByLabelText('Add size'), '   ')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(api.addUniformSize).not.toHaveBeenCalled()
  })
  it.each([
    { labels: ['one'], replacement: 'M', history: false },
    { labels: ['one'], replacement: 'M', history: true },
    { labels: ['M'], replacement: 'one', history: false },
    { labels: ['M', 'L'], replacement: 'one', history: true },
  ])('saves $labels → $replacement with history=$history by removing zero-stock conflicts before creation', async ({ labels, replacement, history }) => {
    const sizes = labels.map((label, index) => ({ ...ITEM.sizes[0], id: 21 + index, label, on_hand: 0, sort_order: index }))
    let catalogue = sizes.map(size => ({ ...size }))
    const operations: string[] = []
    vi.mocked(api.listUniformItems).mockImplementation(async () => [{ ...ITEM, sizes: catalogue }])
    vi.mocked(api.removeUniformSize).mockImplementation(async sizeId => {
      const size = catalogue.find(row => row.id === sizeId)!
      expect(size.on_hand).toBe(0)
      expect(size.held_qty).toBe(0)
      operations.push(`remove:${sizeId}`)
      catalogue = history ? catalogue.map(row => row.id === sizeId ? { ...row, archived_at: '2026-11-04' } : row) : catalogue.filter(row => row.id !== sizeId)
    })
    vi.mocked(api.addUniformSize).mockImplementation(async (itemId, body) => {
      const active = catalogue.filter(size => !size.archived_at)
      if (active.some(size => size.label === 'one') || (body.label === 'one' && active.length > 0)) {
        throw new ApiError(422, 'uniform_sizes_fixed', 'Conflicting active sizes')
      }
      operations.push(`add:${body.label}`)
      const created = { ...sizes[0], id: 25, item_id: itemId, label: body.label, min_qty: body.min_qty ?? null, sort_order: Math.max(-1, ...catalogue.map(size => size.sort_order)) + 1 }
      catalogue = [...catalogue, created]
      return created
    })
    const { onOpenChange, onSuccess } = mount({ ...ITEM, sizes })
    const user = userEvent.setup()
    await screen.findByRole('radio', { name: 'Polo shirt' })
    // A staged quantity on a removed row must not become an obsolete adjustment.
    fireEvent.change(screen.getByLabelText(`Quantity of ${labels[0] === 'one' ? 'One size' : labels[0]}`), { target: { value: '3' } })
    for (const label of labels) await user.click(screen.getByRole('button', { name: `Remove size ${label === 'one' ? 'One size' : label}` }))
    await user.type(screen.getByLabelText('Add size'), ` ${replacement} `)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByLabelText(`Quantity of ${replacement === 'one' ? 'One size' : replacement}`)).toHaveValue(0)
    expect(operations).toEqual([])
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(operations).toEqual([...sizes.map(size => `remove:${size.id}`), `add:${replacement}`])
    expect(catalogue.filter(size => !size.archived_at).map(size => size.label)).toEqual([replacement])
    expect(catalogue.filter(size => !!size.archived_at)).toHaveLength(history ? sizes.length : 0)
    expect(api.createUniformAdjustments).not.toHaveBeenCalled()
    if (history) expect(api.updateUniformSize).toHaveBeenCalledWith(25, { sort_order: 0 })
    else expect(api.updateUniformSize).not.toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalledWith([...sizes.map(size => size.id), 25])
  })
  it('retries a replacement after another removal and creation fail without repeating committed writes', async () => {
    const empty = { ...ITEM.sizes[0], on_hand: 0 }
    const sizes = [empty, { ...empty, id: 22, label: 'L', sort_order: 1 }]
    const activeIds = new Set([21, 22])
    let failedRemoval = false
    let failedCreation = false
    vi.mocked(api.removeUniformSize).mockImplementation(async sizeId => {
      if (sizeId === 22 && !failedRemoval) {
        failedRemoval = true
        throw new ApiError(409, 'uniform_write_conflict', 'Conflict')
      }
      expect(activeIds.delete(sizeId)).toBe(true)
    })
    vi.mocked(api.addUniformSize).mockImplementation(async (itemId, body) => {
      expect(activeIds.size).toBe(0)
      if (!failedCreation) {
        failedCreation = true
        throw new ApiError(409, 'uniform_write_conflict', 'Conflict')
      }
      activeIds.add(25)
      return { ...empty, id: 25, item_id: itemId, label: body.label, sort_order: 0 }
    })
    vi.mocked(api.createUniformAdjustments).mockRejectedValueOnce(new ApiError(409, 'uniform_stale_count', 'Conflict')).mockResolvedValueOnce([])
    const { onOpenChange } = mount({ ...ITEM, sizes })
    const user = userEvent.setup()
    await screen.findByRole('radio', { name: 'Polo shirt' })
    for (const label of ['M', 'L']) await user.click(screen.getByRole('button', { name: `Remove size ${label}` }))
    await user.type(screen.getByLabelText('Add size'), 'one{Enter}')
    fireEvent.change(screen.getByLabelText('Quantity of One size'), { target: { value: '2' } })
    await user.type(screen.getByLabelText('Reason for adjustment'), 'Found stock')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    expect(api.addUniformSize).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.addUniformSize).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.createUniformAdjustments).toHaveBeenCalledTimes(1))
    vi.mocked(api.listUniformItems).mockResolvedValue([{ ...ITEM, sizes: [{ ...empty, id: 25, label: 'one' }] }])
    await user.click(await screen.findByRole('button', { name: 'Review latest version' }))
    await user.click(await screen.findByRole('button', { name: 'Keep my changes and continue editing' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(vi.mocked(api.removeUniformSize).mock.calls.map(([sizeId]) => sizeId)).toEqual([21, 22, 22])
    expect(api.addUniformSize).toHaveBeenCalledTimes(2)
    expect(activeIds).toEqual(new Set([25]))
    expect(api.createUniformAdjustments).toHaveBeenNthCalledWith(2, expect.objectContaining({
      lines: [{ size_id: 25, delta: 2, expected_on_hand: 0 }],
    }))
  })
  it('retries multiple named replacements without recreating a committed size or deleting one size twice', async () => {
    const one = { ...ITEM.sizes[0], label: 'one', on_hand: 0 }
    const active = new Set(['one'])
    let failLarge = true
    vi.mocked(api.removeUniformSize).mockImplementation(async sizeId => {
      expect(sizeId).toBe(21)
      expect(active.delete('one')).toBe(true)
    })
    vi.mocked(api.addUniformSize).mockImplementation(async (itemId, body) => {
      expect(active.has('one')).toBe(false)
      expect(active.has(body.label)).toBe(false)
      if (body.label === 'L' && failLarge) {
        failLarge = false
        throw new ApiError(409, 'uniform_write_conflict', 'Conflict')
      }
      active.add(body.label)
      return { ...one, item_id: itemId, id: body.label === 'M' ? 25 : 26, label: body.label, sort_order: body.label === 'M' ? 0 : 1 }
    })
    const { onOpenChange, onSuccess } = mount({ ...ITEM, sizes: [one] })
    const user = userEvent.setup()
    await screen.findByRole('radio', { name: 'Polo shirt' })
    await user.click(screen.getByRole('button', { name: 'Remove size One size' }))
    await user.type(screen.getByLabelText('Add size'), 'M{Enter}L{Enter}')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    expect(active).toEqual(new Set(['M']))
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(api.removeUniformSize).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.addUniformSize).mock.calls.map(([, body]) => body.label)).toEqual(['M', 'L', 'L'])
    expect(active).toEqual(new Set(['M', 'L']))
    expect(api.createUniformAdjustments).not.toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalledWith([21, 25, 26])
  })
  it('restores a size after a partially committed removal without replaying that deletion', async () => {
    const empty = { ...ITEM.sizes[0], on_hand: 0 }
    vi.mocked(api.removeUniformSize).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError(409, 'uniform_write_conflict', 'Conflict')).mockResolvedValueOnce(undefined)
    vi.mocked(api.addUniformSize).mockResolvedValue({ ...empty, id: 25, sort_order: 0 })
    mount({ ...ITEM, sizes: [empty, { ...empty, id: 22, label: 'L', sort_order: 1 }] })
    const user = userEvent.setup()
    await screen.findByRole('radio', { name: 'Polo shirt' })
    await user.click(screen.getByRole('button', { name: 'Remove size M' }))
    await user.click(screen.getByRole('button', { name: 'Remove size L' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    await user.type(screen.getByLabelText('Add size'), 'm{Enter}')
    expect(screen.getByRole('spinbutton', { name: 'Quantity of M' })).toHaveValue(0)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.removeUniformSize).toHaveBeenCalledTimes(3))
    expect(vi.mocked(api.removeUniformSize).mock.calls.map(([id]) => id)).toEqual([21, 22, 22])
    expect(api.addUniformSize).toHaveBeenCalledTimes(1)
    expect(api.addUniformSize).toHaveBeenCalledWith(2, { label: 'M', min_qty: null })
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
    vi.mocked(api.listUniformItems).mockResolvedValue([{ ...ITEM, drawing: 'dressshirt', version: '2' }])
    await user.click(await screen.findByRole('button', { name: 'Review latest version' }))
    await user.click(await screen.findByRole('button', { name: 'Keep my changes and continue editing' }))
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
  it.each([
    ['receipt', 'voided'], ['receipt', 'removed'], ['receipt', 'reordered'],
    ['adjustment', 'voided'], ['adjustment', 'removed'], ['adjustment', 'reordered'],
  ] as const)('preserves the inline %s void reason when its row is %s by a successful refresh', async (kind, change) => {
    const { client } = mountStockSurface('history')
    const row = (await screen.findByText(kind === 'receipt' ? 'HQ-20' : 'Count correction')).closest('li')!
    const user = userEvent.setup()
    await user.click(within(row).getByRole('button', { name: 'Void record' }))
    const input = within(row).getByRole('textbox', { name: 'Reason for voiding' })
    await user.type(input, 'Original target draft')
    if (kind === 'receipt') {
      const records = change === 'removed' ? [] : change === 'voided'
        ? [{ ...RECEIPT, voided_at: '2026-11-04T12:00:00Z', void_reason: 'Another keeper' }]
        : [{ ...RECEIPT, id: 99, received_on: '2026-11-04', reference: 'New receipt' }, RECEIPT]
      vi.mocked(api.listUniformReceipts).mockResolvedValue(records)
    } else {
      const records = change === 'removed' ? [] : change === 'voided'
        ? [{ ...ADJUSTMENT, voided_at: '2026-11-04T12:00:00Z', void_reason: 'Another keeper' }]
        : [{ ...ADJUSTMENT, id: 99, reason: 'New adjustment' }, ADJUSTMENT]
      vi.mocked(api.listUniformAdjustments).mockResolvedValue(records)
    }
    await act(async () => { await client.refetchQueries({ queryKey: kind === 'receipt' ? uniformKeys.receipts : uniformKeys.adjustments, exact: true }) })
    if (change === 'reordered') await screen.findByText(kind === 'receipt' ? 'New receipt' : 'New adjustment')
    else await waitFor(() => expect(within(row).getByRole('button', { name: 'Void record' })).toBeDisabled())
    expect(within(row).getByRole('textbox', { name: 'Reason for voiding' })).toBe(input)
    expect(input).toHaveValue('Original target draft')
    const confirm = within(row).getByRole('button', { name: 'Void record' })
    if (change === 'reordered') {
      expect(confirm).toBeEnabled()
      await user.click(confirm)
      await waitFor(() => expect(kind === 'receipt' ? api.voidUniformReceipt : api.voidUniformAdjustment).toHaveBeenCalledWith(kind === 'receipt' ? 5 : 6, { reason: 'Original target draft' }))
    } else {
      expect(confirm).toBeDisabled()
      fireEvent.submit(input.closest('form')!)
      expect(api.voidUniformReceipt).not.toHaveBeenCalled()
      expect(api.voidUniformAdjustment).not.toHaveBeenCalled()
      await user.click(within(row).getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('textbox', { name: 'Reason for voiding' })).not.toBeInTheDocument()
    }
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
