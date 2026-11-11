import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type StoreDeliveryRead, type StoreDeliveryScan, type StorePickerItem } from '@/lib/api'
import i18n from '@/lib/i18n'
import { toast } from '@/lib/toast'
import { StoreDeliveryScanPage } from './StoreDeliveryScanPage'

const state = vi.hoisted(() => ({ mobile: false }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => state.mobile }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('./components/ScanNotePreview', () => ({
  ScanNotePreview: ({ render: renderPreview }: { render: (crop: () => React.ReactNode) => React.ReactNode }) => renderPreview(() => <img alt="Note crop" />),
}))

const ITEM: StorePickerItem = {
  id: 4, code: 'ST-0004', name_en: 'Coffee', name_ar: 'قهوة', counting_unit_en: 'Carton', counting_unit_ar: 'كرتون', contains_qty: 24, contains_unit_en: 'Jar', contains_unit_ar: 'علبة', art_kind: null, art_color: null,
}
const UNKNOWN: StorePickerItem = { ...ITEM, id: 5, code: 'ST-0005', name_en: 'Cups', contains_qty: null, contains_unit_en: null, contains_unit_ar: null }
const PACKET: StorePickerItem = { ...UNKNOWN, id: 6, code: 'ST-0006', name_en: 'Green tea', name_ar: 'شاي أخضر', counting_unit_en: 'Packet', counting_unit_ar: 'علبة' }
const SCAN: StoreDeliveryScan = {
  pages: [{ width: 1000, height: 800 }],
  lines: [{ raw_text: 'Coffee 2 CTN + 5 loose', item_id: ITEM.id, match_score: 100, cartons: 2, loose_quantity: 5, carton_contains_qty: null, expiry: null, confidence: 96, page: 0, bbox: { x: 10, y: 50, w: 480, h: 20 } }],
  ocr_available: true,
}
const DELIVERY: StoreDeliveryRead = {
  id: 12, received_on: '2026-10-20', note: null, note_file: null, lines: [],
  created_at: '2026-10-20T10:00:00Z', updated_at: null, created_by_user_id: 1,
}
const button = (key: string) => screen.getByRole('button', { name: i18n.t(key) })
const review = () => button('assets.store.deliveries.review')
const save = () => button('assets.store.deliveries.save')
const edit = () => button('assets.store.deliveries.editLines')

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/holdings/store/deliveries/scan']}><Routes><Route path="/holdings/store/deliveries/scan" element={<StoreDeliveryScanPage />} /><Route path="/holdings/store/deliveries" element={<h1>Deliveries destination</h1>} /></Routes></MemoryRouter></I18nextProvider></QueryClientProvider>)
}
function chooseFile() {
  const file = new File(['photo content'], 'delivery.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText(i18n.t('assets.store.scan.chooseFile')), { target: { files: [file] } })
  return file
}
async function scanFile() {
  const file = chooseFile()
  await screen.findByRole('heading', { name: i18n.t('assets.store.scan.confirmTitle') })
  return file
}
function expiry(value = '2028-09-30') {
  fireEvent.change(screen.getByLabelText(i18n.t('assets.store.expiryInput.dateAria')), { target: { value } })
}
async function fillFallback(user: UserEvent) {
  await screen.findByRole('option', { name: /ST-0004/ })
  await user.selectOptions(screen.getByRole('combobox', { name: /Store item/ }), '4')
  await user.type(screen.getByRole('textbox', { name: 'Coffee: Carton' }), '1')
  await user.click(screen.getByRole('radio', { name: 'No expiry' }))
}

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  state.mobile = false
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listStorePickerItems').mockResolvedValue([ITEM, UNKNOWN, PACKET])
  vi.spyOn(api, 'scanStoreDelivery').mockResolvedValue(SCAN)
  vi.spyOn(api, 'createStoreDelivery').mockResolvedValue(DELIVERY)
  vi.spyOn(api, 'uploadStoreDeliveryNote').mockResolvedValue(DELIVERY)
})

describe('Store delivery receiving', () => {
  it.each([false, true])('offers camera capture only on phones (mobile=%s)', (mobile) => {
    state.mobile = mobile
    renderPage()
    const input = screen.getByLabelText(i18n.t('assets.store.scan.chooseFile'))
    expect(input).toHaveAttribute('accept', 'image/*,application/pdf')
    if (mobile) expect(input).toHaveAttribute('capture', 'environment')
    else expect(input).not.toHaveAttribute('capture')
  })

  it('renders Arabic line numbers with focus on the receiving summary', async () => {
    await i18n.changeLanguage('ar')
    vi.mocked(api.scanStoreDelivery).mockResolvedValue({ ...SCAN, lines: [{ ...SCAN.lines[0], confidence: 30 }] })
    renderPage()
    await scanFile()
    const heading = screen.getByRole('heading', { name: i18n.t('assets.store.scan.confirmTitle') })
    expect(heading.parentElement).toHaveFocus()
    expect(screen.getByText('1', { selector: 'bdi' })).toHaveAttribute('dir', 'ltr')
    expect(screen.getByText(i18n.t('assets.store.scan.onNote'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('assets.store.scan.lowConfidence'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('assets.store.scan.skipLine', { number: 1 }) })).toBeInTheDocument()
  })

  it.each(['en', 'ar'])('converts eight scanned cartons to 192 jars without a false difference (%s)', async (language) => {
    await i18n.changeLanguage(language)
    const user = userEvent.setup()
    vi.mocked(api.scanStoreDelivery).mockResolvedValue({
      ...SCAN, lines: [{ ...SCAN.lines[0], cartons: 8, loose_quantity: 0 }],
    })
    renderPage()
    await scanFile()
    const label = language === 'en' ? ITEM.name_en : ITEM.name_ar
    expect(screen.getByRole('textbox', { name: i18n.t('assets.store.quantity.unitsAria', { label, unit: language === 'en' ? 'Carton' : 'كرتون' }) })).toHaveValue('8')
    expect(screen.getByRole('textbox', { name: i18n.t('assets.store.quantity.looseAria', { label, unit: language === 'en' ? 'Jar' : 'علبة' }) })).toHaveValue('0')
    expect(screen.queryByRole('textbox', { name: new RegExp(i18n.t('assets.store.scan.reason')) })).not.toBeInTheDocument()
    expiry()
    await user.click(review())
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
    await user.click(save())
    await waitFor(() => expect(api.createStoreDelivery).toHaveBeenCalledWith(expect.objectContaining({
      lines: [expect.objectContaining({ quantity: 192, noted_quantity: 192, difference_reason: null })],
    })))
  })

  it('reads once, reviews every line, edits back without losing values, then saves only the reviewed values', async () => {
    const user = userEvent.setup()
    vi.mocked(api.scanStoreDelivery).mockResolvedValue({ ...SCAN, lines: [SCAN.lines[0], { ...SCAN.lines[0], raw_text: 'Cups 3 CTN', item_id: UNKNOWN.id, cartons: 3, loose_quantity: null, carton_contains_qty: 50, expiry: '2029-01' }] })
    renderPage()
    const file = await scanFile()
    expect(screen.getByRole('textbox', { name: 'Coffee: Carton' })).toHaveValue('2')
    expect(screen.getByRole('textbox', { name: 'Coffee: loose Jar' })).toHaveValue('5')
    expect(screen.getAllByRole('img', { name: 'Note crop' })).toHaveLength(2)
    const dates = screen.getAllByLabelText('Expiry date')
    fireEvent.change(dates[0], { target: { value: '2028-09-30' } })
    expect(screen.getByLabelText('Expiry month')).toHaveValue('2029-01')
    await user.click(review())
    expect(screen.getByRole('heading', { name: i18n.t('assets.store.deliveries.reviewTitle') })).toHaveFocus()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('Coffee')).toBeInTheDocument()
    expect(screen.getByText('Cups')).toBeInTheDocument()
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
    await user.click(edit())
    expect(screen.getByRole('textbox', { name: 'Coffee: loose Jar' })).toHaveValue('5')
    fireEvent.change(screen.getByRole('textbox', { name: 'Coffee: loose Jar' }), { target: { value: '3' } })
    await user.type(screen.getByRole('textbox', { name: /Reason for difference/ }), 'Two missing')
    await user.click(review())
    await user.click(save())
    await waitFor(() => expect(api.createStoreDelivery).toHaveBeenCalledWith(expect.objectContaining({ lines: [
      expect.objectContaining({ item_id: ITEM.id, quantity: 51, carton_contains_qty: null, noted_quantity: 53, difference_reason: 'Two missing' }),
      expect.objectContaining({ item_id: UNKNOWN.id, quantity: 3, carton_contains_qty: 50, expiry: '2029-01', noted_quantity: 3 }),
    ] })))
    expect(api.scanStoreDelivery).toHaveBeenCalledTimes(1)
    expect(api.createStoreDelivery).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(api.uploadStoreDeliveryNote).toHaveBeenCalledWith(12, file))
  })

  it('records explicitly undated scanned goods after final review without inventing an expiry or pack conversion', async () => {
    const user = userEvent.setup()
    vi.mocked(api.scanStoreDelivery).mockResolvedValue({
      ...SCAN,
      lines: [{ ...SCAN.lines[0], item_id: UNKNOWN.id, cartons: 3, loose_quantity: null }],
    })
    renderPage()
    await scanFile()
    await user.click(screen.getByRole('radio', { name: 'No expiry' }))
    await user.click(review())
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
    await user.click(save())
    await waitFor(() => expect(api.createStoreDelivery).toHaveBeenCalledWith(expect.objectContaining({
      lines: [expect.objectContaining({
        item_id: UNKNOWN.id, expiry: null, quantity: 3, carton_contains_qty: null,
      })],
    })))
  })

  it('does not review or save an active unmatched line; skipped rows remain explicit and reversible with edits', async () => {
    const user = userEvent.setup()
    vi.mocked(api.scanStoreDelivery).mockResolvedValue({ ...SCAN, lines: [SCAN.lines[0], { ...SCAN.lines[0], raw_text: 'Unmatched row 8 CTN', item_id: null, cartons: 8, match_score: 0 }] })
    renderPage()
    await scanFile()
    for (const input of screen.getAllByLabelText('Expiry date')) fireEvent.change(input, { target: { value: '2028-09-30' } })
    await user.click(review())
    expect(screen.queryByRole('heading', { name: i18n.t('assets.store.deliveries.reviewTitle') })).not.toBeInTheDocument()
    const unmatched = screen.getAllByRole('combobox').find((node) => (node as HTMLSelectElement).value === '')!
    expect(unmatched).toHaveAttribute('aria-invalid', 'true')
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: i18n.t('assets.store.scan.skipLine', { number: 2 }) }))
    await user.click(review())
    expect(screen.getByText('Unmatched row 8 CTN')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
    await user.click(save())
    await waitFor(() => expect(api.createStoreDelivery).toHaveBeenCalledWith(expect.objectContaining({ lines: [expect.objectContaining({ item_id: ITEM.id, quantity: 53 })] })))
  })

  it('preserves skipped edits and discrepancy reasons, and omits only explicitly skipped lines from the final save', async () => {
    const user = userEvent.setup()
    renderPage()
    await scanFile()
    expiry()
    fireEvent.change(screen.getByRole('textbox', { name: 'Coffee: loose Jar' }), { target: { value: '3' } })
    await user.type(screen.getByRole('textbox', { name: /Reason for difference/ }), 'Missing jars')
    await user.click(screen.getByRole('button', { name: i18n.t('assets.store.scan.skipLine', { number: 1 }) }))
    const restore = screen.getByRole('button', { name: i18n.t('assets.store.scan.restoreLine', { number: 1 }) })
    expect(restore).toHaveFocus()
    await user.click(restore)
    expect(screen.getByRole('combobox')).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Coffee: loose Jar' })).toHaveValue('3')
    expect(screen.getByRole('textbox', { name: /Reason for difference/ })).toHaveValue('Missing jars')
    await user.click(review())
    expect(screen.getByText(/Missing jars/)).toBeInTheDocument()
    await user.click(save())
    await waitFor(() => expect(api.createStoreDelivery).toHaveBeenCalledWith(expect.objectContaining({ lines: [expect.objectContaining({ quantity: 51, difference_reason: 'Missing jars' })] })))
  })

  it('requires a discrepancy reason even for zero received, but allows zero against a positive note', async () => {
    const user = userEvent.setup()
    renderPage()
    await scanFile()
    expiry()
    for (const name of ['Coffee: Carton', 'Coffee: loose Jar']) fireEvent.change(screen.getByRole('textbox', { name }), { target: { value: '0' } })
    await user.click(review())
    const reason = screen.getByRole('textbox', { name: /Reason for difference/ })
    expect(reason).toHaveAttribute('aria-invalid', 'true')
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
    await user.type(reason, 'Nothing arrived')
    expect(reason).not.toHaveAttribute('aria-invalid')
    await user.click(review())
    await user.click(save())
    await waitFor(() => expect(api.createStoreDelivery).toHaveBeenCalledWith(expect.objectContaining({ lines: [expect.objectContaining({ quantity: 0, noted_quantity: 53, difference_reason: 'Nothing arrived' })] })))
  })

  it('rejects inconsistent pack metadata without changing the known item conversion, while blank is allowed', async () => {
    const user = userEvent.setup()
    renderPage()
    await scanFile()
    expiry()
    const contents = screen.getByLabelText(i18n.t('assets.store.deliveries.contentsOptional'))
    fireEvent.change(contents, { target: { value: '12' } })
    await user.click(review())
    expect(contents).toHaveAttribute('aria-invalid', 'true')
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
    fireEvent.change(contents, { target: { value: '' } })
    await user.click(review())
    await user.click(save())
    await waitFor(() => expect(api.createStoreDelivery).toHaveBeenCalledWith(expect.objectContaining({ lines: [expect.objectContaining({ quantity: 53, carton_contains_qty: null })] })))
    expect(ITEM.contains_qty).toBe(24)
  })

  it.each([true, false])('uses the same empty editable form and retains its file when OCR returns no lines (available=%s)', async (available) => {
    const user = userEvent.setup()
    vi.mocked(api.scanStoreDelivery).mockResolvedValue({ pages: [], lines: [], ocr_available: available })
    renderPage()
    const file = await scanFile()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(file.name)).toBeInTheDocument()
    await fillFallback(user)
    await user.click(review())
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
    await user.click(edit())
    expect(screen.getByRole('textbox', { name: 'Coffee: Carton' })).toHaveValue('1')
    await user.click(review())
    await user.click(save())
    await waitFor(() => expect(api.uploadStoreDeliveryNote).toHaveBeenCalledWith(12, file))
    expect(api.scanStoreDelivery).toHaveBeenCalledTimes(1)
    expect(api.createStoreDelivery).toHaveBeenCalledTimes(1)
  })

  it.each(['STORE_NOTE_FILE_INVALID', 'STORE_SCAN_TIMEOUT'])('retains only accepted files after reading failure (%s)', async (code) => {
    const user = userEvent.setup()
    vi.mocked(api.scanStoreDelivery).mockRejectedValue(new ApiError(422, code, 'Reading failed'))
    renderPage()
    const file = await scanFile()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    if (code === 'STORE_SCAN_TIMEOUT') expect(screen.getByText(file.name)).toBeInTheDocument()
    else expect(screen.queryByText(file.name)).not.toBeInTheDocument()
    await fillFallback(user)
    await user.click(review())
    await user.click(save())
    await screen.findByRole('heading', { name: 'Deliveries destination' })
    expect(api.createStoreDelivery).toHaveBeenCalledTimes(1)
    if (code === 'STORE_SCAN_TIMEOUT') expect(api.uploadStoreDeliveryNote).toHaveBeenCalledWith(12, file)
    else expect(api.uploadStoreDeliveryNote).not.toHaveBeenCalled()
  })

  it('freezes reviewed rows after durable creation and retries only attachment upload', async () => {
    const user = userEvent.setup()
    vi.mocked(api.uploadStoreDeliveryNote).mockRejectedValueOnce(new Error('Upload unavailable')).mockResolvedValue(DELIVERY)
    renderPage()
    const file = await scanFile()
    expiry()
    await user.click(review())
    await user.click(save())
    const retry = await screen.findByRole('button', { name: i18n.t('assets.store.scan.retryUpload') })
    expect(screen.queryByRole('button', { name: i18n.t('assets.store.deliveries.editLines') })).not.toBeInTheDocument()
    expect(screen.getByText('Coffee')).toBeInTheDocument()
    await user.click(retry)
    await screen.findByRole('heading', { name: 'Deliveries destination' })
    expect(api.createStoreDelivery).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.uploadStoreDeliveryNote).mock.calls).toEqual([[12, file], [12, file]])
  })

  it('finishes an already created delivery without a failed attachment, without creating it again', async () => {
    const user = userEvent.setup()
    vi.mocked(api.uploadStoreDeliveryNote).mockRejectedValue(new Error('Upload unavailable'))
    renderPage()
    await scanFile()
    expiry()
    await user.click(review())
    await user.click(save())
    await user.click(await screen.findByRole('button', { name: i18n.t('assets.store.scan.finishWithoutFile') }))
    await screen.findByRole('heading', { name: 'Deliveries destination' })
    expect(api.createStoreDelivery).toHaveBeenCalledTimes(1)
    expect(api.uploadStoreDeliveryNote).toHaveBeenCalledTimes(1)
    expect(toast.warning).toHaveBeenCalledWith(i18n.t('assets.store.scan.savedWithoutFile'))
  })

  it('keeps skipped scan rows visible when entering a fresh manual line on the same page', async () => {
    const user = userEvent.setup()
    renderPage()
    const file = await scanFile()
    await user.click(screen.getByRole('button', { name: i18n.t('assets.store.scan.skipLine', { number: 1 }) }))
    await user.click(button('assets.store.scan.manual'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(file.name)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('assets.store.scan.restoreLine', { number: 1 }) })).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox'), '5')
    await user.type(screen.getByRole('textbox', { name: 'Cups: Carton' }), '2')
    expiry()
    await user.click(review())
    expect(screen.getByRole('heading', { name: i18n.t('assets.store.scan.skippedLines') })).toBeInTheDocument()
    await user.click(save())
    await waitFor(() => expect(api.createStoreDelivery).toHaveBeenCalledWith(expect.objectContaining({ lines: [expect.objectContaining({ item_id: 5, quantity: 2, source_text: null, noted_quantity: null })] })))
    expect(api.scanStoreDelivery).toHaveBeenCalledTimes(1)
  })

  it('keeps ambiguous quantities blank and revalidates missing fields as they are entered', async () => {
    const user = userEvent.setup()
    vi.mocked(api.scanStoreDelivery).mockResolvedValue({ ...SCAN, lines: [{ ...SCAN.lines[0], cartons: null, loose_quantity: null }] })
    renderPage()
    await scanFile()
    const units = screen.getByRole('textbox', { name: 'Coffee: Carton' })
    const loose = screen.getByRole('textbox', { name: 'Coffee: loose Jar' })
    const date = screen.getByLabelText(/Received on/)
    expect(units).toHaveValue('')
    expect(loose).toHaveValue('')
    await user.click(review())
    expect(units).toHaveAttribute('aria-invalid', 'true')
    expect(units).toHaveFocus()
    fireEvent.change(date, { target: { value: '' } })
    await user.click(review())
    const expiryDate = screen.getByLabelText('Expiry date')
    for (const input of [expiryDate, units, loose, date]) {
      expect(input).toHaveAttribute('aria-invalid', 'true')
      const errorId = input.getAttribute('aria-describedby')!.split(' ')[0]
      expect(document.getElementById(errorId)).toHaveAttribute('role', 'alert')
      expect(input).toHaveAccessibleDescription()
    }
    fireEvent.change(date, { target: { value: '2020-01-02' } })
    expect(date).not.toHaveAttribute('aria-invalid')
    fireEvent.change(expiryDate, { target: { value: '2028-09-30' } })
    expect(expiryDate).not.toHaveAttribute('aria-invalid')
    await user.type(units, '1')
    expect(units).not.toHaveAttribute('aria-invalid')
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    await user.click(review())
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
    await user.click(save())
    await waitFor(() => expect(api.createStoreDelivery).toHaveBeenCalledWith(expect.objectContaining({ lines: [expect.objectContaining({ quantity: 24, noted_quantity: null })] })))
  })

  it('accepts Arabic digits through edit, final review and saving without changing conversion', async () => {
    const user = userEvent.setup()
    await i18n.changeLanguage('ar')
    renderPage()
    await scanFile()
    const label = i18n.t('assets.store.quantity.unitsAria', { label: 'قهوة', unit: 'كرتون' })
    fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value: '٢' } })
    expiry()
    await user.click(review())
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
    await user.click(edit())
    expect(screen.getByRole('textbox', { name: label })).toHaveValue('2')
    await user.click(review())
    await user.click(save())
    await waitFor(() => expect(api.createStoreDelivery).toHaveBeenCalledWith(expect.objectContaining({ lines: [expect.objectContaining({ quantity: 53 })] })))
  })

  it('keeps a skipped manual item Arabic and restores its undated receipt through review, edit and save', async () => {
    const user = userEvent.setup()
    await i18n.changeLanguage('ar')
    renderPage()
    await scanFile()
    await user.click(screen.getByRole('button', { name: i18n.t('assets.store.scan.skipLine', { number: 1 }) }))
    await user.click(button('assets.store.scan.manual'))
    await user.selectOptions(screen.getByRole('combobox'), String(ITEM.id))
    const quantityLabel = i18n.t('assets.store.quantity.unitsAria', { label: ITEM.name_ar, unit: ITEM.counting_unit_ar })
    await user.type(screen.getByRole('textbox', { name: quantityLabel }), '١')
    await user.click(screen.getByRole('radio', { name: i18n.t('assets.store.expiryInput.none') }))
    await user.click(screen.getByRole('button', { name: i18n.t('assets.store.scan.skipLine', { number: 2 }) }))
    const restore = screen.getByRole('button', { name: i18n.t('assets.store.scan.restoreLine', { number: 2 }) })
    const skippedManual = within(restore.closest('li')!)
    expect(skippedManual.getByText(ITEM.name_ar!)).toBeInTheDocument()
    expect(skippedManual.queryByText(ITEM.name_en)).not.toBeInTheDocument()
    await user.click(restore)
    expect(screen.getByRole('textbox', { name: quantityLabel })).toHaveValue('1')
    expect(screen.getByRole('radio', { name: i18n.t('assets.store.expiryInput.none') })).toBeChecked()
    await user.click(review())
    expect(screen.getByText(i18n.t('assets.store.expiry.none'))).toBeInTheDocument()
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
    await user.click(edit())
    expect(screen.getByRole('radio', { name: i18n.t('assets.store.expiryInput.none') })).toBeChecked()
    await user.click(review())
    await user.click(save())
    await waitFor(() => expect(api.createStoreDelivery).toHaveBeenCalledWith(expect.objectContaining({
      lines: [expect.objectContaining({ item_id: ITEM.id, expiry: null, quantity: 24, source_text: null, noted_quantity: null })],
    })))
  })

  it.each([true, false])('never converts scanned cartons into Green tea packets, including item rematching (initial packet match=%s)', async (initialPacketMatch) => {
    const user = userEvent.setup()
    vi.mocked(api.scanStoreDelivery).mockResolvedValue({
      ...SCAN,
      lines: [{ ...SCAN.lines[0], raw_text: 'Green tea 3 CTN', item_id: initialPacketMatch ? PACKET.id : ITEM.id, cartons: 3, loose_quantity: null, carton_contains_qty: 50 }],
    })
    renderPage()
    await scanFile()
    if (!initialPacketMatch) {
      const cartons = screen.getByRole('textbox', { name: 'Coffee: Carton' })
      expect(cartons).toHaveValue('3')
      fireEvent.change(cartons, { target: { value: '4' } })
      await user.selectOptions(screen.getByRole('combobox'), String(PACKET.id))
    }
    const packets = screen.getByRole('textbox', { name: 'Green tea: Packet' })
    expect(packets).toHaveValue('')
    expect(screen.getByText('Green tea 3 CTN')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('assets.store.scan.unknownQuantity'))).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: i18n.t('assets.store.expiryInput.none') }))
    await user.click(review())
    expect(packets).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('heading', { name: i18n.t('assets.store.deliveries.reviewTitle') })).not.toBeInTheDocument()
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
    await user.type(packets, '9')
    await user.click(review())
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
    await user.click(edit())
    expect(screen.getByRole('textbox', { name: 'Green tea: Packet' })).toHaveValue('9')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: String(PACKET.id) } })
    expect(screen.getByRole('textbox', { name: 'Green tea: Packet' })).toHaveValue('9')
    await user.click(review())
    await user.click(save())
    await waitFor(() => expect(api.createStoreDelivery).toHaveBeenCalledWith(expect.objectContaining({
      lines: [expect.objectContaining({ item_id: PACKET.id, quantity: 9, noted_quantity: null, carton_contains_qty: 50, source_text: 'Green tea 3 CTN', difference_reason: null })],
    })))
    expect(api.scanStoreDelivery).toHaveBeenCalledTimes(1)
    expect(api.createStoreDelivery).toHaveBeenCalledTimes(1)
  })

  it('cancels reading and ignores a late scan response', async () => {
    let resolveScan!: (result: StoreDeliveryScan) => void
    vi.mocked(api.scanStoreDelivery).mockReturnValue(new Promise((resolve) => { resolveScan = resolve }))
    const user = userEvent.setup()
    renderPage()
    chooseFile()
    const signal = vi.mocked(api.scanStoreDelivery).mock.calls[0]![1]!
    await user.click(await screen.findByRole('button', { name: i18n.t('assets.store.scan.cancelReading') }))
    expect(signal.aborted).toBe(true)
    await act(async () => resolveScan(SCAN))
    expect(screen.getByLabelText(i18n.t('assets.store.scan.chooseFile'))).toHaveFocus()
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
  })
})
