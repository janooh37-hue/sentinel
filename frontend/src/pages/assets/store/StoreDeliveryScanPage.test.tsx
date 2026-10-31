import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type StoreDeliveryRead, type StoreDeliveryScan, type StorePickerItem } from '@/lib/api'
import i18n from '@/lib/i18n'
import { toast } from '@/lib/toast'
import { todayIso } from '@/pages/vehicles/vehicleUtils'
import { StoreDeliveryScanPage } from './StoreDeliveryScanPage'

const state = vi.hoisted(() => ({ mobile: false }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => state.mobile }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('./components/ScanNotePreview', () => ({
  ScanNotePreview: ({ render: renderPreview }: { render: (crop: () => null) => React.ReactNode }) => renderPreview(() => null),
}))

const ITEM: StorePickerItem = {
  id: 4, code: 'ST-0004', name_en: 'Coffee', name_ar: 'قهوة', counting_unit_en: 'Carton', counting_unit_ar: 'كرتون', contains_qty: 24, contains_unit_en: 'Jar', contains_unit_ar: 'علبة', art_kind: null, art_color: null,
}
const SCAN: StoreDeliveryScan = {
  pages: [{ width: 1000, height: 800 }],
  lines: [{ raw_text: 'Coffee 53 125.00', item_id: ITEM.id, match_score: 100, quantity: 53, confidence: 96, page: 0, bbox: { x: 10, y: 50, w: 480, h: 20 } }],
  ocr_available: true,
}
const DELIVERY: StoreDeliveryRead = {
  id: 12, received_on: '2026-10-20', note: null, note_file: null,
  lines: [{ id: 31, batch_id: 9, item_id: ITEM.id, item_code: ITEM.code, item_name_en: ITEM.name_en, item_name_ar: ITEM.name_ar, counting_unit_en: ITEM.counting_unit_en, counting_unit_ar: ITEM.counting_unit_ar, contains_qty: ITEM.contains_qty, contains_unit_en: ITEM.contains_unit_en, contains_unit_ar: ITEM.contains_unit_ar, art_kind: null, art_color: null, expiry_date: '2028-09-30', expiry_month_only: true, quantity: 53, noted_quantity: 53, difference_reason: null }],
  created_at: '2026-10-20T10:00:00Z', updated_at: null, created_by_user_id: 1,
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/holdings/store/deliveries/scan']}><Routes><Route path="/holdings/store/deliveries/scan" element={<StoreDeliveryScanPage />} /><Route path="/holdings/store/deliveries" element={<h1>Deliveries destination</h1>} /></Routes></MemoryRouter></I18nextProvider></QueryClientProvider>)
  return client
}

function chooseFile() {
  const file = new File(['photo content'], 'delivery.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('Choose a photo or PDF'), { target: { files: [file] } })
  return file
}

async function scanFile() {
  const file = chooseFile()
  await screen.findByRole('heading', { name: 'Confirm delivery' })
  await screen.findByRole('textbox', { name: 'Coffee: Carton' })
  return file
}

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  state.mobile = false
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listStorePickerItems').mockResolvedValue([ITEM])
  vi.spyOn(api, 'scanStoreDelivery').mockResolvedValue(SCAN)
  vi.spyOn(api, 'createStoreDelivery').mockResolvedValue(DELIVERY)
  vi.spyOn(api, 'uploadStoreDeliveryNote').mockResolvedValue(DELIVERY)
})

describe('Store delivery scan', () => {
  it.each([false, true])('offers the accepted file types and camera capture only on phones (mobile=%s)', (mobile) => {
    state.mobile = mobile
    renderPage()
    const input = screen.getByLabelText('Choose a photo or PDF')
    expect(input).toHaveAttribute('accept', 'image/*,application/pdf')
    if (mobile) expect(input).toHaveAttribute('capture', 'environment')
    else expect(input).not.toHaveAttribute('capture')
  })

  it('renders the Arabic confirm surface with isolated line numbers and focus on its summary', async () => {
    await i18n.changeLanguage('ar')
    vi.mocked(api.scanStoreDelivery).mockResolvedValue({ ...SCAN, lines: [{ ...SCAN.lines[0], confidence: 30 }] })
    renderPage()
    const file = new File(['photo content'], 'delivery.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText(i18n.t('assets.store.scan.chooseFile')), { target: { files: [file] } })
    const heading = await screen.findByRole('heading', { name: i18n.t('assets.store.scan.confirmTitle') })
    expect(heading.parentElement).toHaveFocus()
    expect(screen.getByText('1', { selector: 'bdi' })).toHaveAttribute('dir', 'ltr')
    expect(screen.getByText(i18n.t('assets.store.scan.onNote'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('assets.store.scan.lowConfidence'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('assets.store.scan.skipLine', { number: 1 }) })).toBeInTheDocument()
  })

  it('automatically reads the file and prefills the real editor in base units', async () => {
    renderPage()
    const file = await scanFile()
    expect(api.scanStoreDelivery).toHaveBeenCalledWith(file, expect.any(AbortSignal))
    expect(screen.getByRole('combobox', { name: /Store item/ })).toHaveValue('4')
    expect(screen.getByRole('textbox', { name: 'Coffee: Carton' })).toHaveValue('2')
    expect(screen.getByRole('textbox', { name: 'Coffee: loose Jar' })).toHaveValue('5')
    expect(screen.getByText('Coffee 53 125.00')).toBeInTheDocument()
    expect(screen.getByText('On note')).toBeInTheDocument()
    expect(screen.getByLabelText(/Received on/)).toHaveValue(todayIso())
    expect(screen.getByRole('radio', { name: 'Full date' })).toBeChecked()
    expect(screen.getByLabelText('Expiry date')).toHaveValue('')
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
  })

  it('requires a reason for a received difference and saves source, noted quantity and reason', async () => {
    const user = userEvent.setup()
    renderPage()
    const file = await scanFile()
    const loose = screen.getByRole('textbox', { name: 'Coffee: loose Jar' })
    await user.clear(loose)
    await user.type(loose, '3')
    await user.click(screen.getByRole('radio', { name: 'Month only' }))
    fireEvent.change(screen.getByLabelText('Expiry month'), { target: { value: '2028-09' } })
    await user.click(screen.getByRole('button', { name: 'Save delivery' }))
    expect(screen.getByText('Enter a reason when the received quantity differs from the note.')).toBeInTheDocument()
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
    await user.type(screen.getByRole('textbox', { name: /Reason for difference/ }), 'Two jars missing')
    await user.click(screen.getByRole('button', { name: 'Save delivery' }))
    await waitFor(() => expect(api.createStoreDelivery).toHaveBeenCalledWith(expect.objectContaining({
      received_on: todayIso(),
      lines: [{ item_id: ITEM.id, expiry: '2028-09', quantity: 51, source_text: SCAN.lines[0]!.raw_text, noted_quantity: 53, difference_reason: 'Two jars missing' }],
    })))
    expect(api.createStoreDelivery).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(api.uploadStoreDeliveryNote).toHaveBeenCalledWith(DELIVERY.id, file))
    expect(await screen.findByRole('heading', { name: 'Deliveries destination' })).toBeInTheDocument()
  })

  it('allows zero received against a positive noted quantity with a required reason', async () => {
    const user = userEvent.setup()
    renderPage()
    await scanFile()
    for (const name of ['Coffee: Carton', 'Coffee: loose Jar']) {
      const input = screen.getByRole('textbox', { name })
      await user.clear(input)
      await user.type(input, '0')
    }
    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2028-09-30' } })
    await user.click(screen.getByRole('button', { name: 'Save delivery' }))
    expect(screen.getByText('Enter a reason when the received quantity differs from the note.')).toBeInTheDocument()
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
    await user.type(screen.getByRole('textbox', { name: /Reason for difference/ }), 'Nothing arrived')
    await user.click(screen.getByRole('button', { name: 'Save delivery' }))
    await waitFor(() => expect(api.createStoreDelivery).toHaveBeenCalledWith(expect.objectContaining({
      lines: [{ item_id: ITEM.id, expiry: '2028-09-30', quantity: 0, source_text: SCAN.lines[0]!.raw_text, noted_quantity: 53, difference_reason: 'Nothing arrived' }],
    })))
    expect(api.createStoreDelivery).toHaveBeenCalledTimes(1)
  })

  it('flags unmatched rows and skips a row without including it in the save payload', async () => {
    vi.mocked(api.scanStoreDelivery).mockResolvedValue({ ...SCAN, lines: [...SCAN.lines, { ...SCAN.lines[0]!, raw_text: 'Unknown supplies 8', item_id: null, match_score: 20, quantity: 8, confidence: 30 }] })
    const user = userEvent.setup()
    renderPage()
    await scanFile()
    expect(screen.getByText((_, element) => element?.textContent === '1 row needs a look' && element.children.length === 1)).toBeInTheDocument()
    const unmatched = screen.getAllByRole('group', { name: /Line/ }).find((row) => within(row).queryByText('Unknown supplies 8'))!
    expect(within(unmatched).getByRole('combobox', { name: /Store item/ })).toHaveValue('')
    await user.click(within(unmatched).getByRole('button', { name: 'Skip line 1: not a store item' }))
    expect(screen.queryByText('Unknown supplies 8')).not.toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: /Line/ })).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2028-09-30' } })
    await user.click(screen.getByRole('button', { name: 'Save delivery' }))
    await waitFor(() => expect(api.createStoreDelivery).toHaveBeenCalledWith(expect.objectContaining({ lines: [expect.objectContaining({ item_id: ITEM.id, quantity: 53, source_text: SCAN.lines[0]!.raw_text, noted_quantity: 53 })] })))
  })

  it('retains confirmed state on upload failure and retries only the file upload', async () => {
    vi.mocked(api.uploadStoreDeliveryNote).mockRejectedValueOnce(new ApiError(503, 'UNAVAILABLE', 'Upload unavailable')).mockResolvedValue(DELIVERY)
    const user = userEvent.setup()
    renderPage()
    const file = await scanFile()
    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2028-09-30' } })
    await user.click(screen.getByRole('button', { name: 'Save delivery' }))
    expect(await screen.findByText('The delivery was recorded, but the delivery note was not uploaded. Retry the upload or finish without the file.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Coffee: Carton' })).toHaveValue('2')
    expect(screen.getByRole('textbox', { name: 'Coffee: loose Jar' })).toHaveValue('5')
    expect(screen.getByRole('button', { name: 'Finish without file' })).toBeInTheDocument()
    expect(api.createStoreDelivery).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Retry file upload' }))
    expect(await screen.findByRole('heading', { name: 'Deliveries destination' })).toBeInTheDocument()
    expect(api.createStoreDelivery).toHaveBeenCalledTimes(1)
    expect(api.uploadStoreDeliveryNote).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.uploadStoreDeliveryNote).mock.calls).toEqual([[DELIVERY.id, file], [DELIVERY.id, file]])
  })

  it('finishes an already saved delivery without the attachment and never creates it again', async () => {
    vi.mocked(api.uploadStoreDeliveryNote).mockRejectedValue(new ApiError(503, 'UNAVAILABLE', 'Upload unavailable'))
    const user = userEvent.setup()
    renderPage()
    await scanFile()
    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2028-09-30' } })
    await user.click(screen.getByRole('button', { name: 'Save delivery' }))
    await user.click(await screen.findByRole('button', { name: 'Finish without file' }))
    expect(await screen.findByRole('heading', { name: 'Deliveries destination' })).toBeInTheDocument()
    expect(api.createStoreDelivery).toHaveBeenCalledTimes(1)
    expect(api.uploadStoreDeliveryNote).toHaveBeenCalledTimes(1)
    expect(toast.warning).toHaveBeenCalledWith('Delivery recorded without the delivery-note file.')
  })

  it('cancels reading and ignores a late scan response', async () => {
    // The project's ES2023 lib predates Promise.withResolvers.
    let resolveScan!: (result: StoreDeliveryScan) => void
    const promise = new Promise<StoreDeliveryScan>((resolve) => { resolveScan = resolve })
    vi.mocked(api.scanStoreDelivery).mockReturnValue(promise)
    const user = userEvent.setup()
    renderPage()
    chooseFile()
    expect(await screen.findByText('Reading the delivery note…')).toBeInTheDocument()
    const signal = vi.mocked(api.scanStoreDelivery).mock.calls[0]![1]!
    await user.click(screen.getByRole('button', { name: 'Cancel reading' }))
    expect(signal.aborted).toBe(true)
    await act(async () => resolveScan(SCAN))
    expect(screen.getByLabelText('Choose a photo or PDF')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Confirm delivery' })).not.toBeInTheDocument()
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
  })

  it.each([true, false])('opens the manual dialog with the same attachment when OCR is empty (available=%s)', async (available) => {
    vi.mocked(api.scanStoreDelivery).mockResolvedValue({ pages: [], lines: [], ocr_available: available })
    const user = userEvent.setup()
    renderPage()
    const file = chooseFile()
    await user.click(await screen.findByRole('button', { name: 'Enter delivery manually' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(file.name)).toBeInTheDocument()
    await dialog.findByRole('option', { name: /ST-0004/ })
    await user.selectOptions(dialog.getByRole('combobox', { name: /Store item/ }), '4')
    await user.type(dialog.getByRole('textbox', { name: 'Coffee: Carton' }), '1')
    await user.click(dialog.getByRole('radio', { name: 'No expiry' }))
    await user.click(dialog.getByRole('button', { name: 'Save delivery' }))
    await waitFor(() => expect(api.uploadStoreDeliveryNote).toHaveBeenCalledWith(DELIVERY.id, file))
    expect(api.createStoreDelivery).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('Delivery recorded.')
  })
})
