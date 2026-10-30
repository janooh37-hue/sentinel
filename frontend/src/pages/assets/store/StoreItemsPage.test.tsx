import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, type StoreItemRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { toast } from '@/lib/toast'
import { StoreItemsPage } from './StoreItemsPage'

const state = vi.hoisted(() => ({ mobile: false, editable: true }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => state.mobile }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => cap === 'store.view' || state.editable }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const ITEM: StoreItemRead = {
  id: 7, code: 'ST-0007', name_en: 'Tea', name_ar: 'شاي', category_id: 1,
  category: { id: 1, name_en: 'Pantry', name_ar: 'ضيافة' },
  counting_unit_en: 'Carton', counting_unit_ar: 'كرتون', contains_qty: 24,
  contains_unit_en: 'Jar', contains_unit_ar: 'علبة', minimum_level: 72, on_hand: 53,
  archived_at: null, created_at: '2026-10-29T10:00:00', updated_at: null, version: 'v1',
}
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/assets/store/items']}>
    <StoreItemsPage />
  </MemoryRouter></I18nextProvider></QueryClientProvider>)
  return client
}
beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  state.mobile = false
  state.editable = true
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listStoreItems').mockResolvedValue([ITEM])
  vi.spyOn(api, 'listStoreCategories').mockResolvedValue([ITEM.category])
  vi.spyOn(api, 'archiveStoreItem').mockResolvedValue({ ...ITEM, archived_at: '2026-10-29T12:00:00' })
  vi.spyOn(api, 'restoreStoreItem').mockResolvedValue(ITEM)
})

describe('Store items register', () => {
  it.each([false, true])('renders bilingual names, units and low stock (mobile=%s)', async (mobile) => {
    state.mobile = mobile
    renderPage()
    expect(await screen.findByText('Tea')).toHaveAttribute('dir', 'auto')
    expect(screen.getByText('شاي')).toHaveAttribute('dir', 'auto')
    expect(screen.getByText('ST-0007')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByText('Pantry')).toBeInTheDocument()
    expect(screen.getByText('1 Carton = 24 jars')).toBeInTheDocument()
    expect(screen.getByText('2 cartons + 5 jars')).toBeInTheDocument()
    expect(screen.getByText('3 cartons')).toBeInTheDocument()
    expect(screen.getByText('Low stock')).toBeInTheDocument()
    expect(screen.queryByRole('table') != null).toBe(!mobile)
  })

  it.each([false, true])('hides all write actions without edit capability (mobile=%s)', async (mobile) => {
    state.mobile = mobile
    state.editable = false
    vi.mocked(api.listStoreItems).mockResolvedValue([ITEM, { ...ITEM, id: 8, code: 'ST-0008', name_en: 'Coffee', archived_at: '2026-10-29T12:00:00' }])
    renderPage()
    await screen.findByText('Tea')
    expect(screen.queryByRole('button', { name: 'Add item' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Archive/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Restore/ })).not.toBeInTheDocument()
  })

  it('shows archived items on request and restores them', async () => {
    const archived = { ...ITEM, archived_at: '2026-10-29T12:00:00' }
    vi.mocked(api.listStoreItems).mockImplementation(async (flag) => flag ? [archived] : [])
    const user = userEvent.setup()
    const client = renderPage()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    expect(await screen.findByText('No Store items')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Show archived' }))
    expect(await screen.findByText('Archived')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Restore Tea' }))
    await waitFor(() => expect(api.restoreStoreItem).toHaveBeenCalledWith(7))
    expect(api.listStoreItems).toHaveBeenCalledWith(true)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['store'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['store-dashboard'] })
  })

  it.each([false, true])('requires confirmation before archiving (mobile=%s)', async (mobile) => {
    state.mobile = mobile
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Archive Tea' }))
    expect(api.archiveStoreItem).not.toHaveBeenCalled()
    const dialog = within(screen.getByRole('dialog', { name: 'Archive Store item?' }))
    expect(dialog.getByText('Archive Store item?')).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(api.archiveStoreItem).toHaveBeenCalledWith(7))
  })

  it('reports an archive refusal without removing the row', async () => {
    vi.mocked(api.archiveStoreItem).mockRejectedValue(new ApiError(409, 'STORE_ITEM_HAS_STOCK', 'stock'))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Archive Tea' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Archive Store item?' })).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('A Store item with stock on hand cannot be archived.'))
    expect(screen.getByText('Tea')).toBeInTheDocument()
  })

  it('opens the add and edit forms with the appropriate item details', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Tea')
    await user.click(screen.getByRole('button', { name: 'Add item' }))
    expect(within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Name in English' })).toHaveValue('')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Edit Tea' }))
    expect(within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Name in English' })).toHaveValue('Tea')
  })

  it('retries a failed item query', async () => {
    vi.mocked(api.listStoreItems).mockRejectedValueOnce(new Error('Connection unavailable'))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Tea')).toBeInTheDocument()
  })

  it.each([false, true])('renders localized Arabic labels and quantities (mobile=%s)', async (mobile) => {
    state.mobile = mobile
    await i18n.changeLanguage('ar')
    renderPage()
    expect(await screen.findByText('ضيافة')).toBeInTheDocument()
    expect(screen.getByText('رصيد منخفض')).toBeInTheDocument()
    // An LTR run would pair each Arabic unit with the wrong number.
    expect(screen.getByText('2 كرتون + 5 علبة')).toHaveAttribute('dir', 'auto')
    expect(screen.getByText('3 كرتون')).toHaveAttribute('dir', 'auto')
    expect(screen.getByText('1 كرتون = 24 علبة')).toHaveAttribute('dir', 'auto')
    expect(screen.getByText('شاي')).toHaveClass('font-medium')
    expect(screen.getByText('شاي')).toHaveAttribute('lang', 'ar')
    expect(screen.getByText('Tea')).toHaveAttribute('lang', 'en')
    expect(screen.getByText('شاي').nextElementSibling).toBe(screen.getByText('Tea'))
    expect(screen.getByRole('checkbox', { name: 'إظهار المؤرشف' })).toBeInTheDocument()
  })
})
