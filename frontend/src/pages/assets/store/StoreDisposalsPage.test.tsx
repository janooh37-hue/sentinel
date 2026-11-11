import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type StoreBatchRead, type StoreDisposalRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { todayIso } from '@/pages/vehicles/vehicleUtils'

import { StoreDisposalsPage } from './StoreDisposalsPage'
import { DisposalDialog } from './components/DisposalDialog'

const state = vi.hoisted(() => ({ mobile: false, editable: true }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => state.mobile }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => cap === 'store.view' || state.editable }),
}))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const BATCH: StoreBatchRead = {
  id: 91, item_id: 12, item_code: 'ST-0012', item_name_en: 'Tea', item_name_ar: 'شاي',
  counting_unit_en: 'Carton', counting_unit_ar: 'كرتون', contains_qty: 24,
  contains_unit_en: 'Jar', contains_unit_ar: 'علبة', art_kind: null, art_color: null, expiry_date: '2025-09-30',
  expiry_month_only: true, on_hand: 60, days_to_expiry: -300,
}
const DISPOSAL: StoreDisposalRead = {
  id: 10, batch_id: BATCH.id, item_id: BATCH.item_id, item_code: BATCH.item_code,
  item_name_en: BATCH.item_name_en, item_name_ar: BATCH.item_name_ar,
  counting_unit_en: BATCH.counting_unit_en, counting_unit_ar: BATCH.counting_unit_ar,
  contains_qty: BATCH.contains_qty, contains_unit_en: BATCH.contains_unit_en,
  contains_unit_ar: BATCH.contains_unit_ar, art_kind: null, art_color: null, expiry_date: BATCH.expiry_date,
  expiry_month_only: true, disposed_on: '2026-09-10', quantity: 29, reason: 'expired',
  note: 'Removed from pantry shelf', created_by_user_id: 1, created_at: '2026-09-10T10:00:00',
}

function renderPage(itemId?: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/holdings/store/disposals']}>
          {itemId == null ? <StoreDisposalsPage /> : <DisposalDialog open onOpenChange={vi.fn()} itemId={itemId} />}
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return client
}

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  state.mobile = false
  state.editable = true
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listStoreDisposals').mockResolvedValue([DISPOSAL])
  vi.spyOn(api, 'listStoreBatches').mockResolvedValue([BATCH])
  vi.spyOn(api, 'createStoreDisposal').mockResolvedValue(DISPOSAL)
  vi.spyOn(api, 'deleteStoreDisposal').mockResolvedValue(undefined)
})

describe('Store disposals', () => {
  it('preserves drawer item preselection and selects its earliest stocked expiry', async () => {
    vi.mocked(api.listStoreBatches).mockResolvedValue([
      { ...BATCH, id: 95, expiry_date: '2027-01-01', days_to_expiry: 60 },
      BATCH,
      { ...BATCH, id: 96, item_id: 14, item_name_en: 'Water' },
    ])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><DisposalDialog open itemId={12} onOpenChange={vi.fn()} /></I18nextProvider></QueryClientProvider>)
    expect(await screen.findByRole('textbox', { name: 'Quantity: Carton' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tea/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /Water/ })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Expired' })).toBeChecked()
  })

  it.each([false, true])('renders newest first with Batch quantity, expiry and reason (mobile=%s)', async (mobile) => {
    state.mobile = mobile
    vi.spyOn(api, 'listStoreDisposals').mockResolvedValue([
      DISPOSAL,
      { ...DISPOSAL, id: 11, disposed_on: '2026-10-01', item_name_en: 'Water', item_code: 'ST-0013', reason: 'damaged', expiry_date: null, quantity: 5, contains_qty: null, note: null },
    ])
    renderPage()
    expect(await screen.findByText('Tea')).toBeInTheDocument()
    expect(screen.getByText('2025-09')).toBeInTheDocument()
    expect(screen.getByText('1 carton + 5 jars')).toBeInTheDocument()
    expect(screen.getByText('Expired')).toBeInTheDocument()
    expect(screen.getByText('Damaged')).toBeInTheDocument()
    expect(screen.getByText('No expiry')).toBeInTheDocument()
    expect(screen.getByText('Removed from pantry shelf')).toBeInTheDocument()
    const rows = mobile ? screen.getAllByRole('listitem') : screen.getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('Water')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Tea')).toBeInTheDocument()
  })

  it.each([false, true])('renders Arabic names and disposal labels (mobile=%s)', async (mobile) => {
    state.mobile = mobile
    await i18n.changeLanguage('ar')
    renderPage()
    expect(await screen.findByText('شاي')).toBeInTheDocument()
    expect(screen.getByText('منتهي الصلاحية')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'تسجيل إتلاف' })).toBeInTheDocument()
    expect(screen.getByText('ST-0012')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByText('2025-09')).toHaveAttribute('dir', 'ltr')
  })

  it.each([false, true])('hides recording and deletion without store.edit (mobile=%s)', async (mobile) => {
    state.mobile = mobile
    state.editable = false
    renderPage()
    await screen.findByText('Tea')
    expect(screen.queryByRole('button', { name: 'Record disposal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete disposal/ })).not.toBeInTheDocument()
  })

  it.each([
    { expiry_date: '2025-09-30', expiry_month_only: true, expiry: '2025-09' },
    { expiry_date: '2025-09-10', expiry_month_only: false, expiry: '2025-09-10' },
    { expiry_date: null, expiry_month_only: false, expiry: null },
  ])('records the selected Batch and base-unit quantity with expiry=$expiry', async ({ expiry_date, expiry_month_only, expiry }) => {
    vi.spyOn(api, 'listStoreBatches').mockResolvedValue([{ ...BATCH, expiry_date, expiry_month_only }])
    const user = userEvent.setup()
    const client = renderPage()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await user.click(screen.getByRole('button', { name: 'Record disposal' }))
    const dialog = within(screen.getByRole('dialog'))
    await user.click(await dialog.findByRole('button', { name: /Tea/ }))
    await user.click(await dialog.findByRole('combobox', { name: /Batch/ }))
    await user.click(screen.getByRole('option', { name: /ST-0012/ }))
    expect(dialog.getByRole('radio', { name: 'Expired' })).toBeChecked()
    await user.type(dialog.getByRole('textbox', { name: 'Quantity: Carton' }), '1')
    await user.type(dialog.getByRole('textbox', { name: 'Quantity: loose Jar' }), '5')
    await user.type(dialog.getByRole('textbox', { name: 'Note' }), '  Broken seal  ')
    await user.click(dialog.getByRole('button', { name: 'Record disposal' }))
    await waitFor(() => expect(api.createStoreDisposal).toHaveBeenCalledWith({
      disposed_on: todayIso(), item_id: 12, expiry, quantity: 29, reason: 'expired', note: 'Broken seal',
    }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['store'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['store-dashboard'] })
  })

  it('refuses quantities above on-hand before sending a request', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Record disposal' }))
    const dialog = within(screen.getByRole('dialog'))
    await user.click(await dialog.findByRole('button', { name: /Tea/ }))
    await user.click(await dialog.findByRole('combobox', { name: /Batch/ }))
    await user.click(screen.getByRole('option', { name: /ST-0012/ }))
    await user.type(dialog.getByRole('textbox', { name: 'Quantity: Carton' }), '3')
    await user.click(dialog.getByRole('button', { name: 'Record disposal' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent("The disposal quantity cannot exceed this Batch's on-hand quantity.")
    expect(api.createStoreDisposal).not.toHaveBeenCalled()
  })

  it.each(['0', '1.5', '-1'])('refuses invalid disposal quantity %s', async (quantity) => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Record disposal' }))
    const dialog = within(screen.getByRole('dialog'))
    await user.click(await dialog.findByRole('button', { name: /Tea/ }))
    await user.click(await dialog.findByRole('combobox', { name: /Batch/ }))
    await user.click(screen.getByRole('option', { name: /ST-0012/ }))
    await user.type(dialog.getByRole('textbox', { name: 'Quantity: Carton' }), quantity)
    await user.click(dialog.getByRole('button', { name: 'Record disposal' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('Enter a whole-number quantity of at least 1 base unit.')
    expect(api.createStoreDisposal).not.toHaveBeenCalled()
  })

  it('offers only stocked Batches and defaults the reason from each selected Batch', async () => {
    vi.spyOn(api, 'listStoreBatches').mockResolvedValue([
      BATCH,
      { ...BATCH, id: 92, item_code: 'ST-0013', days_to_expiry: 20 },
      { ...BATCH, id: 93, item_code: 'ST-0014', on_hand: 0 },
    ])
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Record disposal' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('combobox', { name: /Batch/ })).toBeDisabled()
    await user.click(await dialog.findByRole('button', { name: /Tea/ }))
    await user.click(await dialog.findByRole('combobox', { name: /Batch/ }))
    expect(screen.queryByRole('option', { name: /ST-0014/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /ST-0012/ }))
    expect(dialog.getByRole('radio', { name: 'Expired' })).toBeChecked()
    await user.click(dialog.getByRole('combobox', { name: /Batch/ }))
    await user.click(screen.getByRole('option', { name: /ST-0013/ }))
    expect(dialog.getByRole('radio', { name: 'Damaged' })).toBeChecked()
  })

  it.each([0, 12])('submits historical quantities above today\'s %s balance for the matching item', async (onHand) => {
    vi.spyOn(api, 'listStoreBatches').mockResolvedValue([
      { ...BATCH, on_hand: onHand },
      { ...BATCH, id: 92, item_id: 99, item_code: 'OTHER-ITEM', on_hand: 0 },
    ])
    const user = userEvent.setup()
    renderPage(BATCH.item_id)
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText(/Disposal date/), { target: { value: '2026-01-01' } })
    await user.click(await dialog.findByRole('combobox', { name: /Batch/ }))
    expect(screen.queryByRole('option', { name: /OTHER-ITEM/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /ST-0012/ })).not.toHaveTextContent('On hand')
    await user.click(screen.getByRole('option', { name: /ST-0012/ }))
    expect(dialog.queryByText(/On hand/)).not.toBeInTheDocument()
    await user.type(dialog.getByRole('textbox', { name: 'Quantity: Carton' }), '٣')
    await user.type(dialog.getByRole('textbox', { name: 'Quantity: loose Jar' }), '۵')
    await user.click(dialog.getByRole('button', { name: 'Record disposal' }))
    await waitFor(() => expect(api.createStoreDisposal).toHaveBeenCalledWith({
      disposed_on: '2026-01-01', item_id: 12, expiry: '2025-09', quantity: 77, reason: 'expired', note: null,
    }))
  })

  it('clears an empty historical Batch and its quantity when switching back to today', async () => {
    vi.spyOn(api, 'listStoreBatches').mockResolvedValue([{ ...BATCH, on_hand: 0 }])
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Record disposal' }))
    const dialog = within(screen.getByRole('dialog'))
    const date = dialog.getByLabelText(/Disposal date/)
    fireEvent.change(date, { target: { value: '2026-01-01' } })
    await user.click(await dialog.findByRole('button', { name: /Tea/ }))
    await user.click(await dialog.findByRole('combobox', { name: /Batch/ }))
    await user.click(screen.getByRole('option', { name: /ST-0012/ }))
    await user.type(dialog.getByRole('textbox', { name: 'Quantity: Carton' }), '3')
    fireEvent.change(date, { target: { value: todayIso() } })
    expect(dialog.getByRole('button', { name: 'Record disposal' })).toBeDisabled()
    expect(dialog.queryByRole('textbox', { name: 'Quantity: Carton' })).not.toBeInTheDocument()
    expect(api.createStoreDisposal).not.toHaveBeenCalled()
    fireEvent.change(date, { target: { value: '2026-01-01' } })
    await user.click(await dialog.findByRole('combobox', { name: /Batch/ }))
    await user.click(screen.getByRole('option', { name: /ST-0012/ }))
    expect(dialog.getByRole('textbox', { name: 'Quantity: Carton' })).toHaveValue('')
  })

  it('reapplies today\'s cap to retained quantities and clears that error for a past date', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Record disposal' }))
    const dialog = within(screen.getByRole('dialog'))
    const date = dialog.getByLabelText(/Disposal date/)
    fireEvent.change(date, { target: { value: '2026-01-01' } })
    await user.click(await dialog.findByRole('button', { name: /Tea/ }))
    await user.click(await dialog.findByRole('combobox', { name: /Batch/ }))
    await user.click(screen.getByRole('option', { name: /ST-0012/ }))
    await user.type(dialog.getByRole('textbox', { name: 'Quantity: Carton' }), '3')
    fireEvent.change(date, { target: { value: todayIso() } })
    expect(dialog.getAllByText(/On hand/).length).toBeGreaterThan(0)
    await user.click(dialog.getByRole('button', { name: 'Record disposal' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent("The disposal quantity cannot exceed this Batch's on-hand quantity.")
    expect(api.createStoreDisposal).not.toHaveBeenCalled()
    fireEvent.change(date, { target: { value: '2026-01-01' } })
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Record disposal' }))
    await waitFor(() => expect(api.createStoreDisposal).toHaveBeenCalledWith(expect.objectContaining({
      disposed_on: '2026-01-01', quantity: 72,
    })))
  })

  it('shows backend historical-availability errors without applying today\'s cap', async () => {
    vi.spyOn(api, 'listStoreBatches').mockResolvedValue([{ ...BATCH, on_hand: 0 }])
    vi.spyOn(api, 'createStoreDisposal').mockRejectedValue(new ApiError(422, 'STORE_DISPOSAL_EXCEEDS_STOCK', 'Historical availability exceeded'))
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Record disposal' }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText(/Disposal date/), { target: { value: '2026-01-01' } })
    await user.click(await dialog.findByRole('button', { name: /Tea/ }))
    await user.click(await dialog.findByRole('combobox', { name: /Batch/ }))
    await user.click(screen.getByRole('option', { name: /ST-0012/ }))
    await user.type(dialog.getByRole('textbox', { name: 'Quantity: loose Jar' }), '1')
    await user.click(dialog.getByRole('button', { name: 'Record disposal' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('A Disposal cannot remove more than the Batch has on hand.')
    expect(api.createStoreDisposal).toHaveBeenCalledWith(expect.objectContaining({ disposed_on: '2026-01-01', quantity: 1 }))
  })

  it('deletes only after confirmation and refreshes stock queries', async () => {
    const user = userEvent.setup()
    const client = renderPage()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await user.click(await screen.findByRole('button', { name: 'Delete disposal for ST-0012 on 2026-09-10' }))
    expect(api.deleteStoreDisposal).not.toHaveBeenCalled()
    const confirmation = within(screen.getByRole('dialog', { name: 'Delete disposal?' }))
    expect(confirmation.getByText('ST-0012')).toHaveAttribute('dir', 'ltr')
    expect(confirmation.getByText('2026-09-10')).toHaveAttribute('dir', 'ltr')
    await user.click(confirmation.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.deleteStoreDisposal).toHaveBeenCalledWith(10))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['store'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['store-dashboard'] })
  })

  it('keeps server stock errors visible in the form', async () => {
    vi.spyOn(api, 'createStoreDisposal').mockRejectedValue(new ApiError(422, 'STORE_DISPOSAL_EXCEEDS_STOCK', 'Stock changed'))
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Record disposal' }))
    const dialog = within(screen.getByRole('dialog'))
    await user.click(await dialog.findByRole('button', { name: /Tea/ }))
    await user.click(await dialog.findByRole('combobox', { name: /Batch/ }))
    await user.click(screen.getByRole('option', { name: /ST-0012/ }))
    await user.type(dialog.getByRole('textbox', { name: 'Quantity: Carton' }), '1')
    await user.click(dialog.getByRole('button', { name: 'Record disposal' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('A Disposal cannot remove more than the Batch has on hand.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('explains empty disposals and retries a failed list', async () => {
    vi.spyOn(api, 'listStoreDisposals').mockRejectedValueOnce(new Error('Connection unavailable')).mockResolvedValue([])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No disposals recorded')).toBeInTheDocument()
    expect(screen.getByText(/Disposals record expired or damaged stock removed from the shelf/)).toBeInTheDocument()
  })
})
