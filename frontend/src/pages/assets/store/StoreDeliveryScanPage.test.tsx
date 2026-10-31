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
  ScanNotePreview: ({ render: renderPreview }: { render: (crop: () => React.ReactNode) => React.ReactNode }) => renderPreview(() => <img alt="Note crop" />),
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
    await user.click(within(unmatched).getByRole('button', { name: 'Not a store item: skip, line 2' }))
    expect(screen.getByText('Unknown supplies 8').closest('li')).toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: /Line/ })).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2028-09-30' } })
    await user.click(screen.getByRole('button', { name: 'Save delivery' }))
    await waitFor(() => expect(api.createStoreDelivery).toHaveBeenCalledWith(expect.objectContaining({ lines: [expect.objectContaining({ item_id: ITEM.id, quantity: 53, source_text: SCAN.lines[0]!.raw_text, noted_quantity: 53 })] })))
  })

  it.each(['en', 'ar'])('places a non-destructive, label-matched skip action last and pairs the crop with on-note quantity (%s)', async (language) => {
    await i18n.changeLanguage(language)
    renderPage()
    fireEvent.change(screen.getByLabelText(i18n.t('assets.store.scan.chooseFile')), { target: { files: [new File(['photo'], 'note.png', { type: 'image/png' })] } })
    const button = await screen.findByRole('button', { name: i18n.t('assets.store.scan.skipLine', { number: 1 }) })
    expect(button.getAttribute('aria-label')?.startsWith(button.textContent!)).toBe(true)
    expect(button).not.toHaveClass('text-accent')
    expect(button).not.toHaveClass('text-destructive')
    const row = button.closest('fieldset')!
    expect(row.lastElementChild).toContainElement(button)
    const onNote = within(row).getByText(i18n.t('assets.store.scan.onNote')).parentElement!
    expect(within(onNote).getByRole('img', { name: 'Note crop' })).toBeInTheDocument()
    if (language === 'en') {
      expect(within(onNote).getByText('2 cartons + 5 jars')).toBeInTheDocument()
      expect(within(row).getByText('cartons')).toBeInTheDocument()
      expect(within(row).getByText('jars')).toBeInTheDocument()
      fireEvent.change(within(row).getByRole('textbox', { name: 'Coffee: Carton' }), { target: { value: '1' } })
      expect(within(row).getByText('carton')).toBeInTheDocument()
    }
  })

  it('restores skipped rows with their edits, reason, focus and announcement', async () => {
    const user = userEvent.setup()
    renderPage()
    await scanFile()
    fireEvent.change(screen.getByRole('textbox', { name: 'Coffee: loose Jar' }), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2028-09-30' } })
    await user.type(screen.getByRole('textbox', { name: /Reason for difference/ }), 'Missing jars')
    await user.click(screen.getByRole('button', { name: 'Not a store item: skip, line 1' }))
    expect(screen.getByRole('heading', { name: 'Confirm delivery' }).parentElement).toHaveFocus()
    expect(screen.getByText((_, element) => element?.getAttribute('role') === 'status' && element.textContent === 'Line 1 skipped. You can restore it below.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Restore, line 1' }))
    expect(screen.getByRole('combobox', { name: /Store item/ })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Coffee: loose Jar' })).toHaveValue('3')
    expect(screen.getByLabelText('Expiry date')).toHaveValue('2028-09-30')
    expect(screen.getByRole('textbox', { name: /Reason for difference/ })).toHaveValue('Missing jars')
    expect(screen.getByText((_, element) => element?.getAttribute('role') === 'status' && element.textContent === 'Line 1 restored.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restore, line 1' })).not.toBeInTheDocument()
  })

  it('offers working choose-another and manual actions when all lines are skipped, retaining the valid photo', async () => {
    const user = userEvent.setup()
    renderPage()
    const file = await scanFile()
    await user.click(screen.getByRole('button', { name: 'Not a store item: skip, line 1' }))
    await user.click(screen.getByRole('button', { name: 'Enter delivery manually' }))
    expect(within(screen.getByRole('dialog')).getByText(file.name)).toBeInTheDocument()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Choose another note' }))
    expect(screen.getByLabelText('Choose a photo or PDF')).toHaveFocus()
    expect(screen.queryByRole('heading', { name: 'Confirm delivery' })).not.toBeInTheDocument()
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
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
    expect(screen.getByLabelText('Choose a photo or PDF')).toHaveFocus()
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

  it('revalidates expiry, quantity and received date on change and links each inline error', async () => {
    const user = userEvent.setup()
    renderPage()
    await scanFile()
    const units = screen.getByRole('textbox', { name: 'Coffee: Carton' })
    const loose = screen.getByRole('textbox', { name: 'Coffee: loose Jar' })
    const date = screen.getByLabelText(/Received on/)
    fireEvent.change(units, { target: { value: '' } })
    fireEvent.change(loose, { target: { value: '' } })
    fireEvent.change(date, { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: 'Save delivery' }))
    const expiry = screen.getByLabelText('Expiry date')
    expect(expiry).toHaveAccessibleDescription(/Enter a complete expiry date or month from the packaging/)
    expect(expiry).not.toHaveAccessibleDescription(/No expiry/)
    expect(units).toHaveAccessibleDescription(/Enter a whole received quantity/)
    expect(loose).toHaveAccessibleDescription(/Enter a whole received quantity/)
    expect(date).toHaveAccessibleDescription('Enter a received date on or before today.')
    for (const input of [expiry, units, loose, date]) {
      const errorId = input.getAttribute('aria-describedby')!.split(' ')[0]
      expect(document.getElementById(errorId)).toHaveAttribute('role', 'alert')
    }
    fireEvent.change(date, { target: { value: todayIso() } })
    expect(date).not.toHaveAttribute('aria-invalid')
    fireEvent.change(expiry, { target: { value: '2028-09-30' } })
    expect(expiry).not.toHaveAttribute('aria-invalid')
    fireEvent.change(units, { target: { value: '2' } })
    fireEvent.change(loose, { target: { value: '5' } })
    expect(units).not.toHaveAttribute('aria-invalid')
    expect(loose).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText('Correct the indicated fields before saving.')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
  })

  it('retranslates existing errors on language change and clears reason and summary immediately when fixed', async () => {
    const user = userEvent.setup()
    renderPage()
    await scanFile()
    fireEvent.change(screen.getByRole('textbox', { name: 'Coffee: loose Jar' }), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2028-09-30' } })
    await user.click(screen.getByRole('button', { name: 'Save delivery' }))
    expect(screen.getByRole('textbox', { name: /Reason for difference/ })).toHaveAccessibleDescription(i18n.t('assets.store.scan.reasonRequired'))
    await act(async () => { await i18n.changeLanguage('ar') })
    expect(screen.queryByText('Enter a reason when the received quantity differs from the note.')).not.toBeInTheDocument()
    const reason = screen.getByRole('textbox', { name: new RegExp(i18n.t('assets.store.scan.reason')) })
    expect(reason).toHaveAccessibleDescription(i18n.t('assets.store.scan.reasonRequired'))
    await user.type(reason, 'عبوتان ناقصتان')
    expect(reason).not.toHaveAttribute('aria-invalid')
    expect(reason).not.toHaveAttribute('aria-describedby')
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(api.createStoreDelivery).not.toHaveBeenCalled()
  })

  it('clears item errors on selection and duplicate-batch errors on changing expiry', async () => {
    vi.mocked(api.scanStoreDelivery).mockResolvedValue({ ...SCAN, lines: [SCAN.lines[0], { ...SCAN.lines[0], item_id: null }] })
    const user = userEvent.setup()
    renderPage()
    await scanFile()
    await user.click(screen.getByRole('button', { name: 'Save delivery' }))
    const picker = screen.getAllByRole('combobox', { name: /Store item/ }).find((input) => (input as HTMLSelectElement).value === '')!
    expect(picker).toHaveAccessibleDescription(/Select a Store item/)
    await user.selectOptions(picker, '4')
    expect(picker).not.toHaveAttribute('aria-invalid')
    const expiries = screen.getAllByLabelText('Expiry date')
    for (const input of expiries) fireEvent.change(input, { target: { value: '2028-09-30' } })
    expect(expiries[1]).toHaveAccessibleDescription(/This item and expiry already appear/)
    fireEvent.change(expiries[1], { target: { value: '2028-10-31' } })
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it.each(['STORE_NOTE_FILE_BAD_FORMAT', 'STORE_NOTE_FILE_TOO_LARGE', 'STORE_NOTE_FILE_EMPTY', 'STORE_NOTE_FILE_INVALID'])('does not attach a rejected scan file to manual entry (%s)', async (code) => {
    vi.mocked(api.scanStoreDelivery).mockRejectedValue(new ApiError(422, code, 'Rejected scan file'))
    const user = userEvent.setup()
    renderPage()
    const file = new File(['not an image'], code === 'STORE_NOTE_FILE_BAD_FORMAT' ? 'not-image.txt' : 'invalid.png', { type: 'text/plain' })
    fireEvent.change(screen.getByLabelText('Choose a photo or PDF'), { target: { files: [file] } })
    await user.click(await screen.findByRole('button', { name: 'Enter delivery manually' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.queryByText(file.name)).not.toBeInTheDocument()
    await dialog.findByRole('option', { name: /ST-0004/ })
    await user.selectOptions(dialog.getByRole('combobox', { name: /Store item/ }), '4')
    await user.type(dialog.getByRole('textbox', { name: 'Coffee: Carton' }), '1')
    await user.click(dialog.getByRole('radio', { name: 'No expiry' }))
    await user.click(dialog.getByRole('button', { name: 'Save delivery' }))
    expect(await screen.findByRole('heading', { name: 'Deliveries destination' })).toBeInTheDocument()
    expect(api.createStoreDelivery).toHaveBeenCalledTimes(1)
    expect(api.uploadStoreDeliveryNote).not.toHaveBeenCalled()
  })

  it('keeps a valid note for manual entry after a reading timeout', async () => {
    vi.mocked(api.scanStoreDelivery).mockRejectedValue(new ApiError(422, 'STORE_SCAN_TIMEOUT', 'Timed out'))
    const user = userEvent.setup()
    renderPage()
    const file = chooseFile()
    await user.click(await screen.findByRole('button', { name: 'Enter delivery manually' }))
    expect(within(screen.getByRole('dialog')).getByText(file.name)).toBeInTheDocument()
  })
})
