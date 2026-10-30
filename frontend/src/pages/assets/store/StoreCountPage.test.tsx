import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type StoreCountRead, type StoreExpectedBatch, type StorePickerItem } from '@/lib/api'
import i18n from '@/lib/i18n'
import { toast } from '@/lib/toast'
import { todayIso } from '@/pages/vehicles/vehicleUtils'
import { StoreCountPage } from './StoreCountPage'

const state = vi.hoisted(() => ({ mobile: false, editable: true }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => state.mobile }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => state.editable }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const ITEM: StorePickerItem = {
  id: 1, code: 'ST-0001', name_en: 'Tea', name_ar: 'شاي', counting_unit_en: 'Carton', counting_unit_ar: 'كرتون',
  contains_qty: 24, contains_unit_en: 'jar', contains_unit_ar: 'علبة', art_kind: null, art_color: null,
}
const FIRST: StoreExpectedBatch = {
  item_id: 1, item_code: 'ST-0001', item_name_en: 'Tea', item_name_ar: 'شاي',
  counting_unit_en: 'Carton', counting_unit_ar: 'كرتون', contains_qty: 24, contains_unit_en: 'jar', contains_unit_ar: 'علبة', art_kind: null, art_color: null,
  batch_id: 10, expiry_date: '2028-09-30', expiry_month_only: true,
}
const SECOND: StoreExpectedBatch = { ...FIRST, batch_id: 11, expiry_date: null, expiry_month_only: false }
const SAVED: StoreCountRead = {
  id: 7, month: '2026-09', counted_on: '2026-09-20', note: 'Monthly count',
  lines: [{ ...FIRST, id: 1, quantity: 125 }, { ...SECOND, id: 2, quantity: 49 }],
  created_at: '2026-09-20T10:00:00', updated_at: null, created_by_user_id: 1,
}

function LocationProbe() {
  return <output aria-label="Current location">{useLocation().pathname}</output>
}

function renderPage(entry = '/holdings/store/counts/new') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter initialEntries={[entry]}>
    <Routes><Route path="/holdings/store/counts/new" element={<StoreCountPage />} /><Route path="/holdings/store/counts/:id" element={<StoreCountPage />} /><Route path="/holdings/store/counts" element={<p>Counts destination</p>} /></Routes><LocationProbe />
  </MemoryRouter></I18nextProvider></QueryClientProvider>)
  return client
}

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  state.mobile = false
  state.editable = true
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'getStoreCountExpected').mockResolvedValue([FIRST, SECOND])
  vi.spyOn(api, 'listStorePickerItems').mockResolvedValue([ITEM])
  vi.spyOn(api, 'listStoreBatches').mockResolvedValue([])
  vi.spyOn(api, 'getStoreCount').mockResolvedValue(SAVED)
  vi.spyOn(api, 'createStoreCount').mockResolvedValue(SAVED)
  vi.spyOn(api, 'updateStoreCount').mockResolvedValue(SAVED)
})

describe('blank stock count entry', () => {
  it.each([false, true])('renders every expected batch blank and focuses the first omitted quantity (mobile=%s)', async (mobile) => {
    state.mobile = mobile
    const user = userEvent.setup()
    renderPage()
    const first = await screen.findByRole('textbox', { name: 'Tea · 2028-09: Carton' })
    const second = screen.getByRole('textbox', { name: 'Tea · No expiry: Carton' })
    expect(first).toHaveValue('')
    expect(second).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'Tea · 2028-09: loose jar' })).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Save stock count' }))
    expect(api.createStoreCount).not.toHaveBeenCalled()
    expect(screen.getAllByText('Enter the counted quantity, including 0 if none remain.')).toHaveLength(2)
    expect(first).toHaveFocus()
    expect(first).toHaveAttribute('aria-invalid', 'true')
  })

  it.each([false, true])('sends cartons plus loose in base units and accepts zero (mobile=%s)', async (mobile) => {
    state.mobile = mobile
    const user = userEvent.setup()
    const client = renderPage()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await user.type(await screen.findByRole('textbox', { name: 'Tea · 2028-09: Carton' }), '3')
    await user.type(screen.getByRole('textbox', { name: 'Tea · 2028-09: loose jar' }), '5')
    await user.type(screen.getByRole('textbox', { name: 'Tea · No expiry: Carton' }), '0')
    expect(screen.getByText('2 of 2 entered')).toHaveAttribute('role', 'status')
    await user.click(screen.getByRole('button', { name: 'Save stock count' }))
    await waitFor(() => expect(api.createStoreCount).toHaveBeenCalledWith({ counted_on: todayIso(), note: null, lines: [
      { item_id: 1, expiry: '2028-09', quantity: 77 }, { item_id: 1, expiry: null, quantity: 0 },
    ] }))
    expect(await screen.findByText('Counts destination')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('Stock count saved.')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['store'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['store-dashboard'] })
  })

  it.each([false, true])('adds a batch, rejects duplicates and includes its quantity in the save (mobile=%s)', async (mobile) => {
    state.mobile = mobile
    vi.spyOn(api, 'getStoreCountExpected').mockResolvedValue([])
    const user = userEvent.setup()
    renderPage()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Store item' }), '1')
    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2029-10-15' } })
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    const quantity = screen.getByRole('textbox', { name: 'Tea · 2029-10-15: Carton' })
    expect(quantity).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    expect(screen.getByText('This item and expiry are already listed. Enter its quantity in the existing row.')).toBeInTheDocument()
    await user.type(quantity, '2')
    await user.click(screen.getByRole('button', { name: 'Save stock count' }))
    await waitFor(() => expect(api.createStoreCount).toHaveBeenCalledWith({ counted_on: todayIso(), note: null, lines: [{ item_id: 1, expiry: '2029-10-15', quantity: 48 }] }))
  })

  it.each(['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'])('treats a month and its final day as one batch (TZ=%s)', async (zone) => {
    const previous = process.env.TZ
    process.env.TZ = zone
    try {
      vi.spyOn(api, 'getStoreCountExpected').mockResolvedValue([])
      const user = userEvent.setup()
      renderPage()
      await user.selectOptions(await screen.findByRole('combobox', { name: 'Store item' }), '1')
      await user.click(screen.getByRole('radio', { name: 'Month only' }))
      fireEvent.change(screen.getByLabelText('Expiry month'), { target: { value: '2028-02' } })
      await user.click(screen.getByRole('button', { name: 'Add batch' }))
      await user.type(screen.getByRole('textbox', { name: 'Tea · 2028-02: Carton' }), '1')
      await user.click(screen.getByRole('radio', { name: 'Full date' }))
      fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2028-02-29' } })
      await user.click(screen.getByRole('button', { name: 'Add batch' }))
      expect(screen.getByText('This item and expiry are already listed. Enter its quantity in the existing row.')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Save stock count' }))
      await waitFor(() => expect(api.createStoreCount).toHaveBeenCalledWith({ counted_on: todayIso(), note: null, lines: [{ item_id: 1, expiry: '2028-02', quantity: 24 }] }))
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  })

  it('starts saved quantities blank, retaining extra saved batches, and replaces the saved count', async () => {
    vi.spyOn(api, 'getStoreCountExpected').mockResolvedValue([FIRST])
    const user = userEvent.setup()
    renderPage('/holdings/store/counts/7')
    const first = await screen.findByRole('textbox', { name: 'Tea · 2028-09: Carton' })
    const second = screen.getByRole('textbox', { name: 'Tea · No expiry: Carton' })
    expect(first).toHaveValue('')
    expect(second).toHaveValue('')
    expect(screen.queryByDisplayValue('125')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Counted on')).toHaveValue('2026-09-20')
    await user.type(first, '1')
    await user.type(second, '0')
    await user.click(screen.getByRole('button', { name: 'Save stock count' }))
    await waitFor(() => expect(api.updateStoreCount).toHaveBeenCalledWith(7, { counted_on: '2026-09-20', note: 'Monthly count', lines: [{ item_id: 1, expiry: '2028-09', quantity: 24 }, { item_id: 1, expiry: null, quantity: 0 }] }))
  })

  it.each([false, true])('marks listed missing batches and resolves additional rows from the server (mobile=%s)', async (mobile) => {
    state.mobile = mobile
    vi.spyOn(api, 'getStoreCountExpected').mockResolvedValue([FIRST])
    vi.spyOn(api, 'listStoreBatches').mockResolvedValue([{ ...SECOND, id: 11, on_hand: 48, days_to_expiry: null }])
    vi.spyOn(api, 'createStoreCount').mockRejectedValueOnce(new ApiError(422, 'STORE_COUNT_MISSING_BATCHES', 'msg', {
      batches: [{ batch_id: 10, item_code: 'ST-0001', expiry_date: '2028-09-30' }, { batch_id: 11, item_code: 'ST-0001', expiry_date: null }],
    }))
    const user = userEvent.setup()
    renderPage()
    const first = await screen.findByRole('textbox', { name: 'Tea · 2028-09: Carton' })
    await user.type(first, '1')
    await user.click(screen.getByRole('button', { name: 'Save stock count' }))
    const extra = await screen.findByRole('textbox', { name: 'Tea · No expiry: Carton' })
    expect(extra).toHaveValue('')
    expect(extra).toHaveAttribute('aria-invalid', 'true')
    expect(first).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getAllByText('This batch must be counted. Enter its quantity, including 0 if none remain.')).toHaveLength(2)
    expect(screen.getByText(/The Stock count leaves out Batches/)).toBeInTheDocument()
  })

  it('links to the existing count after a month conflict', async () => {
    vi.spyOn(api, 'getStoreCountExpected').mockResolvedValue([])
    vi.spyOn(api, 'createStoreCount').mockRejectedValueOnce(new ApiError(409, 'STORE_COUNT_MONTH_EXISTS', 'msg', { count_id: 7 }))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('No expected batches for this date')
    await user.click(screen.getByRole('button', { name: 'Save stock count' }))
    expect(await screen.findByRole('link', { name: 'Open the existing stock count' })).toHaveAttribute('href', '/holdings/store/counts/7')
  })

  it('refetches required batches when the date changes', async () => {
    renderPage()
    await screen.findByRole('textbox', { name: 'Tea · 2028-09: Carton' })
    fireEvent.change(screen.getByLabelText('Counted on'), { target: { value: '2026-09-22' } })
    await waitFor(() => expect(api.getStoreCountExpected).toHaveBeenCalledWith('2026-09-22'))
  })

  it('removes a manually added batch without retaining its entered quantity', async () => {
    vi.spyOn(api, 'getStoreCountExpected').mockResolvedValue([])
    const user = userEvent.setup()
    renderPage()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Store item' }), '1')
    await user.click(screen.getByRole('radio', { name: 'No expiry' }))
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    await user.type(screen.getByRole('textbox', { name: 'Tea · No expiry: Carton' }), '3')
    await user.click(screen.getByRole('button', { name: 'Remove batch: Tea · No expiry' }))
    expect(screen.queryByRole('textbox', { name: 'Tea · No expiry: Carton' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    expect(screen.getByRole('textbox', { name: 'Tea · No expiry: Carton' })).toHaveValue('')
  })
})
