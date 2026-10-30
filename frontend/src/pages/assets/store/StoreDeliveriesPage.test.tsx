import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type StoreDeliveryRead, type StorePickerItem } from '@/lib/api'
import i18n from '@/lib/i18n'
import { toast } from '@/lib/toast'
import { todayIso } from '@/pages/vehicles/vehicleUtils'
import { StoreDeliveriesPage } from './StoreDeliveriesPage'

const state = vi.hoisted(() => ({ mobile: false, editable: true }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => state.mobile }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => cap === 'store.view' || state.editable }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const ITEM: StorePickerItem = {
  id: 4, code: 'ST-0004', name_en: 'Coffee', name_ar: 'قهوة', counting_unit_en: 'Carton', counting_unit_ar: 'كرتون', contains_qty: 24, contains_unit_en: 'Jar', contains_unit_ar: 'علبة',
}
const DELIVERY: StoreDeliveryRead = {
  id: 12, received_on: '2026-10-20', note: 'HQ delivery', note_file: null,
  lines: [{ id: 31, batch_id: 9, item_id: ITEM.id, item_code: ITEM.code, item_name_en: ITEM.name_en, item_name_ar: ITEM.name_ar, counting_unit_en: ITEM.counting_unit_en, counting_unit_ar: ITEM.counting_unit_ar, contains_qty: ITEM.contains_qty, contains_unit_en: ITEM.contains_unit_en, contains_unit_ar: ITEM.contains_unit_ar, expiry_date: '2028-09-30', expiry_month_only: true, quantity: 53 }],
  created_at: '2026-10-20T10:00:00Z', updated_at: null, created_by_user_id: 1,
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/assets/store/deliveries']}><StoreDeliveriesPage /></MemoryRouter></I18nextProvider></QueryClientProvider>)
  return client
}

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  state.mobile = false
  state.editable = true
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listStoreDeliveries').mockResolvedValue([DELIVERY])
  vi.spyOn(api, 'listStorePickerItems').mockResolvedValue([ITEM])
  vi.spyOn(api, 'createStoreDelivery').mockResolvedValue(DELIVERY)
  vi.spyOn(api, 'uploadStoreDeliveryNote').mockResolvedValue(DELIVERY)
  vi.spyOn(api, 'deleteStoreDelivery').mockResolvedValue(undefined)
})

describe('Store deliveries', () => {
  it.each([false, true])('renders newest deliveries with batch quantities (mobile=%s)', async (mobile) => {
    state.mobile = mobile
    vi.spyOn(api, 'listStoreDeliveries').mockResolvedValue([DELIVERY, { ...DELIVERY, id: 13, received_on: '2026-10-25', note: 'Most recent' }])
    renderPage()
    expect(await screen.findByText('Most recent')).toBeInTheDocument()
    expect(screen.getAllByText('Coffee')).toHaveLength(2)
    expect(screen.getAllByText('ST-0004')).toHaveLength(2)
    expect(screen.getAllByText('2028-09')).toHaveLength(2)
    expect(screen.getAllByText('2 cartons + 5 jars')).toHaveLength(2)
    const entries = mobile ? screen.getAllByRole('article') : screen.getAllByRole('row').slice(1)
    expect(entries[0]).toHaveTextContent('2026-10-25')
    expect(entries[1]).toHaveTextContent('2026-10-20')
  })

  it.each([false, true])('hides write actions without store.edit (mobile=%s)', async (mobile) => {
    state.mobile = mobile
    state.editable = false
    renderPage()
    await screen.findByText('Coffee')
    expect(screen.queryByRole('button', { name: 'Log delivery' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete delivery/ })).not.toBeInTheDocument()
  })

  it.each(['month', 'none'])('logs a delivery with %s expiry in base units', async (mode) => {
    const user = userEvent.setup()
    const client = renderPage()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await user.click(screen.getByRole('button', { name: 'Log delivery' }))
    const dialog = within(screen.getByRole('dialog'))
    await dialog.findByRole('option', { name: /ST-0004/ })
    await user.selectOptions(dialog.getByRole('combobox', { name: /Store item/ }), '4')
    await user.type(dialog.getByRole('textbox', { name: 'Coffee: Carton' }), '2')
    await user.type(dialog.getByRole('textbox', { name: 'Coffee: loose Jar' }), '5')
    await user.click(dialog.getByRole('radio', { name: mode === 'month' ? 'Month only' : 'No expiry' }))
    if (mode === 'month') fireEvent.change(dialog.getByLabelText('Expiry month'), { target: { value: '2028-09' } })
    await user.type(dialog.getByRole('textbox', { name: 'Note' }), 'Received from HQ')
    await user.click(dialog.getByRole('button', { name: 'Save delivery' }))
    await waitFor(() => expect(api.createStoreDelivery).toHaveBeenCalledWith({ received_on: todayIso(), note: 'Received from HQ', lines: [{ item_id: 4, expiry: mode === 'month' ? '2028-09' : null, quantity: 53 }] }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['store'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['store-dashboard'] })
  })

  it('requires a complete expiry and a positive quantity', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Log delivery' }))
    const dialog = within(screen.getByRole('dialog'))
    await dialog.findByRole('option', { name: /ST-0004/ })
    await user.selectOptions(dialog.getByRole('combobox', { name: /Store item/ }), '4')
    await user.type(dialog.getByRole('textbox', { name: 'Coffee: Carton' }), '0')
    await user.click(dialog.getByRole('button', { name: 'Save delivery' }))
    expect(dialog.getByText('Enter a complete expiry date or month, or select No expiry.')).toBeInTheDocument()
    expect(dialog.getByText('Enter a whole quantity of at least one base unit.')).toBeInTheDocument()
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
  })

  it('rejects duplicate batches including a month and its final day', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Log delivery' }))
    const dialog = within(screen.getByRole('dialog'))
    await dialog.findByRole('option', { name: /ST-0004/ })
    await user.click(dialog.getByRole('button', { name: 'Add line' }))
    const lines = dialog.getAllByRole('group', { name: /Line/ })
    for (const line of lines) {
      await user.selectOptions(within(line).getByRole('combobox', { name: /Store item/ }), '4')
      await user.type(within(line).getByRole('textbox', { name: 'Coffee: Carton' }), '1')
    }
    await user.click(within(lines[0]).getByRole('radio', { name: 'Month only' }))
    fireEvent.change(within(lines[0]).getByLabelText('Expiry month'), { target: { value: '2028-09' } })
    fireEvent.change(within(lines[1]).getByLabelText('Expiry date'), { target: { value: '2028-09-30' } })
    await user.click(dialog.getByRole('button', { name: 'Save delivery' }))
    expect(dialog.getByText('This item and expiry already appear in another line. Combine their quantities.')).toBeInTheDocument()
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
  })

  it('retains the saved delivery and clearly reports an attachment upload failure', async () => {
    vi.spyOn(api, 'uploadStoreDeliveryNote').mockRejectedValue(new ApiError(503, 'UNAVAILABLE', 'Upload unavailable'))
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Log delivery' }))
    const dialogElement = screen.getByRole('dialog')
    const dialog = within(dialogElement)
    await dialog.findByRole('option', { name: /ST-0004/ })
    await user.selectOptions(dialog.getByRole('combobox', { name: /Store item/ }), '4')
    await user.type(dialog.getByRole('textbox', { name: 'Coffee: Carton' }), '1')
    await user.click(dialog.getByRole('radio', { name: 'No expiry' }))
    const input = dialogElement.querySelector('input[type="file"]')
    expect(input).not.toBeNull()
    const file = new File(['pdf content'], 'delivery.pdf', { type: 'application/pdf' })
    fireEvent.change(input!, { target: { files: [file] } })
    await user.click(dialog.getByRole('button', { name: 'Save delivery' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.createStoreDelivery).toHaveBeenCalledTimes(1)
    expect(api.uploadStoreDeliveryNote).toHaveBeenCalledWith(DELIVERY.id, file)
    expect(screen.getByRole('alert')).toHaveTextContent('The delivery was recorded, but the delivery note was not uploaded.')
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Upload unavailable'))
  })

  it('checks delivery-note size before saving', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Log delivery' }))
    const dialogElement = screen.getByRole('dialog')
    const file = new File(['x'], 'too-large.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 + 1 })
    fireEvent.change(dialogElement.querySelector('input[type="file"]')!, { target: { files: [file] } })
    expect(within(dialogElement).getByText('The delivery note exceeds 10 MiB.')).toBeInTheDocument()
    expect(api.uploadStoreDeliveryNote).not.toHaveBeenCalled()
  })

  it('only deletes after confirmation', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Delete delivery received on 2026-10-20' }))
    expect(api.deleteStoreDelivery).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('dialog', { name: 'Delete this delivery?' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.deleteStoreDelivery).toHaveBeenCalledWith(12))
    expect(toast.success).toHaveBeenCalledWith('Delivery deleted.')
  })

  it('opens an image delivery note in the local viewer', async () => {
    vi.spyOn(api, 'listStoreDeliveries').mockResolvedValue([{ ...DELIVERY, note_file: { name: 'delivery.png', media_type: 'image/png', size: 100, url: '/api/v1/store/deliveries/12/note-file' } }])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'View delivery note: delivery.png' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute('src', '/api/v1/store/deliveries/12/note-file')
  })

  it('renders Arabic item names and copy', async () => {
    await i18n.changeLanguage('ar')
    state.mobile = true
    renderPage()
    expect(await screen.findByText('قهوة')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'تسجيل استلام' })).toBeInTheDocument()
    expect(screen.getByText('ST-0004')).toHaveAttribute('dir', 'ltr')
  })
})
