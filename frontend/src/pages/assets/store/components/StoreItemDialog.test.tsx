import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, type StoreItemRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { StoreItemDialog } from './StoreItemDialog'

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const CATEGORY = { id: 1, name_en: 'Pantry', name_ar: 'ضيافة' }
const ITEM: StoreItemRead = {
  id: 7, code: 'ST-0007', name_en: 'Tea', name_ar: 'شاي', category_id: 1, category: CATEGORY,
  counting_unit_en: 'Carton', counting_unit_ar: 'كرتون', contains_qty: 24,
  contains_unit_en: 'Jar', contains_unit_ar: 'علبة', art_kind: null, art_color: null, minimum_level: 53,
  on_hand: 0, archived_at: null, created_at: '2026-10-29T10:00:00', updated_at: null, version: 'v1',
}

function renderDialog(item: StoreItemRead | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onOpenChange = vi.fn()
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter>
    <StoreItemDialog open onOpenChange={onOpenChange} item={item} />
  </MemoryRouter></I18nextProvider></QueryClientProvider>)
  return { client, onOpenChange }
}

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listStoreCategories').mockResolvedValue([CATEGORY])
  vi.spyOn(api, 'createStoreItem').mockResolvedValue(ITEM)
  vi.spyOn(api, 'updateStoreItem').mockResolvedValue(ITEM)
})

describe('Store item dialog', () => {
  it('locks contains fields for an item with stock, but saves other fields without contains', async () => {
    const user = userEvent.setup()
    renderDialog({ ...ITEM, on_hand: 24 })
    await screen.findByRole('combobox', { name: 'Category' })
    expect(screen.getByRole('spinbutton', { name: 'Contained quantity' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Contained unit in English' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Contained unit in Arabic' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Contains' })).toBeDisabled()
    expect(screen.getByText('What a Counting unit contains cannot change once the item has stock records.')).toBeInTheDocument()
    await user.clear(screen.getByRole('textbox', { name: 'Name in English' }))
    await user.type(screen.getByRole('textbox', { name: 'Name in English' }), 'Black tea')
    await user.click(screen.getByRole('button', { name: 'Save item' }))
    await waitFor(() => expect(api.updateStoreItem).toHaveBeenCalledWith(7, {
      name_en: 'Black tea', name_ar: 'شاي', category_id: 1, counting_unit_en: 'Carton', counting_unit_ar: 'كرتون', minimum_level: 53,
    }, 'v1'))
  })

  it('locks contains after server refusal and permits resubmission of other changes', async () => {
    vi.mocked(api.updateStoreItem).mockRejectedValueOnce(new ApiError(409, 'STORE_ITEM_CONTAINS_LOCKED', 'locked'))
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog(ITEM)
    const quantity = screen.getByRole('spinbutton', { name: 'Contained quantity' })
    await user.clear(quantity)
    await user.type(quantity, '12')
    await user.clear(screen.getByRole('textbox', { name: 'Name in English' }))
    await user.type(screen.getByRole('textbox', { name: 'Name in English' }), 'Black tea')
    await user.click(screen.getByRole('button', { name: 'Save item' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('What a Counting unit contains cannot change once the item has stock records.')
    expect(quantity).toBeDisabled()
    expect(quantity).toHaveValue(24)
    expect(screen.getByRole('textbox', { name: 'Contained unit in English' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Contained unit in Arabic' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Contains' })).toBeDisabled()
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save item' }))
    await waitFor(() => expect(api.updateStoreItem).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.updateStoreItem).mock.calls[0][1]).toHaveProperty('contains_qty', 12)
    expect(vi.mocked(api.updateStoreItem).mock.calls[0][1]).not.toHaveProperty('contains_unit_en')
    expect(vi.mocked(api.updateStoreItem).mock.calls[0][1]).not.toHaveProperty('contains_unit_ar')
    expect(vi.mocked(api.updateStoreItem).mock.calls[1][1]).not.toHaveProperty('contains_qty')
    expect(vi.mocked(api.updateStoreItem).mock.calls[1][1]).toHaveProperty('name_en', 'Black tea')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('converts cartons plus loose units to base units in the create payload', async () => {
    const user = userEvent.setup()
    const { client, onOpenChange } = renderDialog()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await user.type(screen.getByRole('textbox', { name: 'Name in English' }), 'Tea')
    await user.click(screen.getByRole('combobox', { name: 'Category' }))
    await user.click(await screen.findByRole('option', { name: 'Pantry' }))
    await user.click(screen.getByRole('checkbox', { name: 'Contains' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Contained quantity' }), '24')
    await user.type(screen.getByRole('textbox', { name: 'Contained unit in English' }), 'Jar')
    await user.type(screen.getByRole('textbox', { name: 'Contained unit in Arabic' }), 'علبة')
    await user.type(screen.getByRole('textbox', { name: 'Minimum level: Carton' }), '2')
    await user.type(screen.getByRole('textbox', { name: 'Minimum level: loose Jar' }), '5')
    await user.click(screen.getByRole('button', { name: 'Save item' }))
    await waitFor(() => expect(api.createStoreItem).toHaveBeenCalledWith({
      name_en: 'Tea', name_ar: null, category_id: 1, counting_unit_en: 'Carton', counting_unit_ar: 'كرتون',
      contains_qty: 24, contains_unit_en: 'Jar', contains_unit_ar: 'علبة', minimum_level: 53,
    }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['store'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['store-dashboard'] })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('creates a bilingual category inline and selects it for the item', async () => {
    const newCategory = { id: 2, name_en: 'Protective', name_ar: 'وقاية' }
    vi.spyOn(api, 'createStoreCategory').mockImplementation(async () => {
      vi.mocked(api.listStoreCategories).mockResolvedValue([CATEGORY, newCategory])
      return newCategory
    })
    const user = userEvent.setup()
    renderDialog()
    await user.type(screen.getByRole('textbox', { name: 'Name in English' }), 'Gloves')
    await user.click(screen.getByRole('button', { name: 'Add category' }))
    const group = within(screen.getByRole('group', { name: 'Add category' }))
    await user.type(group.getByRole('textbox', { name: 'Category name in English' }), 'Protective')
    await user.click(group.getByRole('button', { name: 'Save category' }))
    expect(api.createStoreCategory).not.toHaveBeenCalled()
    expect(group.getByRole('alert')).toHaveTextContent('Enter the category name in English and Arabic.')
    await user.type(group.getByRole('textbox', { name: 'Category name in Arabic' }), 'وقاية')
    await user.click(group.getByRole('button', { name: 'Save category' }))
    await waitFor(() => expect(api.createStoreCategory).toHaveBeenCalledWith({ name_en: 'Protective', name_ar: 'وقاية' }))
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveTextContent('Protective')
    await user.click(screen.getByRole('button', { name: 'Save item' }))
    await waitFor(() => expect(api.createStoreItem).toHaveBeenCalledWith(expect.objectContaining({ category_id: 2, minimum_level: null, contains_qty: null, contains_unit_en: null, contains_unit_ar: null })))
  })

  it('omits unchanged contains fields on update', async () => {
    const user = userEvent.setup()
    renderDialog(ITEM)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save item' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Save item' }))
    await waitFor(() => expect(api.updateStoreItem).toHaveBeenCalled())
    expect(vi.mocked(api.updateStoreItem).mock.calls[0][1]).not.toHaveProperty('contains_qty')
    expect(vi.mocked(api.updateStoreItem).mock.calls[0][1]).not.toHaveProperty('contains_unit_en')
    expect(vi.mocked(api.updateStoreItem).mock.calls[0][1]).not.toHaveProperty('contains_unit_ar')
  })

  it('clears all contains fields together when Contains is turned off', async () => {
    const user = userEvent.setup()
    renderDialog(ITEM)
    await user.click(screen.getByRole('checkbox', { name: 'Contains' }))
    await user.click(screen.getByRole('button', { name: 'Save item' }))
    await waitFor(() => expect(api.updateStoreItem).toHaveBeenCalledWith(7, expect.objectContaining({
      contains_qty: null, contains_unit_en: null, contains_unit_ar: null,
    }), 'v1'))
  })

  it('retries a failed category query before allowing the item to be saved', async () => {
    vi.mocked(api.listStoreCategories).mockRejectedValueOnce(new Error('Connection unavailable'))
    const user = userEvent.setup()
    renderDialog()
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.getByRole('button', { name: 'Save item' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save item' })).toBeEnabled())
    await user.click(screen.getByRole('combobox', { name: 'Category' }))
    expect(await screen.findByRole('option', { name: 'Pantry' })).toBeInTheDocument()
  })

  it('shows localized server errors without closing', async () => {
    vi.mocked(api.updateStoreItem).mockRejectedValue(new ApiError(412, 'STORE_ITEM_VERSION_CONFLICT', 'stale'))
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog(ITEM)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save item' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Save item' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This Store item was changed by someone else.')
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
