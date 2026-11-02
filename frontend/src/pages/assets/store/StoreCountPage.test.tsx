import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type StoreCountRead, type StoreExpectedBatch, type StoreItemRead, type StorePickerItem } from '@/lib/api'
import i18n from '@/lib/i18n'
import { formatNumber } from '@/lib/language'
import { todayIso } from '@/pages/vehicles/vehicleUtils'
import { StoreCountPage } from './StoreCountPage'
import { countDraftKey } from './storeCountDraft'
import { storeKeys } from './storeUtils'

const state = vi.hoisted(() => ({ editable: true, userId: 1 }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => state.editable }) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: state.userId } }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const ITEM: StorePickerItem = {
  id: 1, code: 'ST-0001', name_en: 'Tea', name_ar: 'شاي', counting_unit_en: 'Carton', counting_unit_ar: 'كرتون',
  contains_qty: 24, contains_unit_en: 'jar', contains_unit_ar: 'علبة', art_kind: 'box', art_color: null,
}
const SHELF_ITEM: StoreItemRead = {
  ...ITEM, category_id: 1, category: { id: 1, name_en: 'Pantry', name_ar: 'ضيافة' },
  minimum_level: null, archived_at: null, created_at: '2026-01-01T00:00:00', updated_at: null, on_hand: 900, version: '1',
}
const FIRST: StoreExpectedBatch = {
  item_id: 1, item_code: 'ST-0001', item_name_en: 'Tea', item_name_ar: 'شاي',
  counting_unit_en: 'Carton', counting_unit_ar: 'كرتون', contains_qty: 24, contains_unit_en: 'jar', contains_unit_ar: 'علبة', art_kind: 'box', art_color: null,
  batch_id: 10, expiry_date: '2028-09-30', expiry_month_only: true,
}
const SECOND: StoreExpectedBatch = { ...FIRST, batch_id: 11, expiry_date: null, expiry_month_only: false }
const SAVED: StoreCountRead = {
  id: 7, month: '2026-09', counted_on: '2026-09-20', note: 'Previous operator note',
  lines: [{ ...FIRST, id: 1, quantity: 125 }, { ...SECOND, id: 2, quantity: 49 }],
  created_at: '2026-09-20T10:00:00', updated_at: null, created_by_user_id: 1,
}

function renderPage(entry = '/holdings/store/counts/new') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const view = render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter initialEntries={[entry]}>
    <Routes><Route path="/holdings/store/counts/new" element={<StoreCountPage />} /><Route path="/holdings/store/counts/:id" element={<StoreCountPage />} /><Route path="/holdings/store/counts" element={<div>Counts destination<Link to="/holdings/store/counts/new">Open new count</Link></div>} /></Routes>
  </MemoryRouter></I18nextProvider></QueryClientProvider>)
  return { ...view, client }
}
function countField(context: string, field: string | RegExp = new RegExp(ITEM.counting_unit_en)) {
  return within(screen.getByRole('group', { name: context })).getByRole('textbox', { name: field })
}
async function findCountField(context: string, field: string | RegExp = new RegExp(ITEM.counting_unit_en)) {
  return within(await screen.findByRole('group', { name: context })).getByRole('textbox', { name: field })
}
function queryCountField(context: string, field: string | RegExp = new RegExp(ITEM.counting_unit_en)) {
  const group = screen.queryByRole('group', { name: context })
  return group ? within(group).queryByRole('textbox', { name: field }) : null
}
async function start(user: UserEvent) {
  await user.click(await screen.findByRole('button', { name: 'Start counting' }))
}
async function enter(user: UserEvent, expiry: string, units: string, loose = '0') {
  await user.type(await findCountField(`Tea · ${expiry}`), units)
  await user.type(countField(`Tea · ${expiry}`, 'Loose: jar'), loose)
}
async function saveReview(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Review count' }))
  await user.click(screen.getByRole('checkbox', { name: 'I reviewed the quantities I physically counted.' }))
  await user.click(screen.getByRole('button', { name: 'Save stock count' }))
}
async function discoverItem(user: UserEvent) {
  await user.click(screen.getByText('Found another item? Add its batch'))
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Store item' }), '1')
}

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  localStorage.clear()
  state.editable = true
  state.userId = 1
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'getStoreCountExpected').mockResolvedValue([FIRST, SECOND])
  vi.spyOn(api, 'listStorePickerItems').mockResolvedValue([ITEM])
  vi.spyOn(api, 'listStoreItems').mockResolvedValue([SHELF_ITEM])
  vi.spyOn(api, 'listStoreCategories').mockResolvedValue([SHELF_ITEM.category])
  vi.spyOn(api, 'listStoreBatches').mockResolvedValue([])
  vi.spyOn(api, 'getStoreCount').mockResolvedValue(SAVED)
  vi.spyOn(api, 'createStoreCount').mockResolvedValue(SAVED)
  vi.spyOn(api, 'updateStoreCount').mockResolvedValue(SAVED)
})

describe('focused blind stock count', () => {
  it('shows one item and all its batches, follows shelf order, and keeps item and batch progress separate', async () => {
    const coffee = { ...SHELF_ITEM, id: 2, code: 'ST-0002', name_en: 'Coffee', art_kind: 'jar' }
    vi.mocked(api.listStoreItems).mockResolvedValue([SHELF_ITEM, coffee])
    vi.mocked(api.getStoreCountExpected).mockResolvedValue([FIRST, SECOND, {
      ...FIRST, item_id: 2, item_code: 'ST-0002', item_name_en: 'Coffee', art_kind: 'jar', batch_id: 12,
    }])
    const user = userEvent.setup()
    renderPage()
    await start(user)
    expect(await findCountField('Coffee · 2028-09')).toHaveValue('')
    expect(queryCountField('Tea · 2028-09')).not.toBeInTheDocument()
    expect(screen.getByText('Item 1 of 2')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Batches counted' })).toHaveAttribute('max', '3')
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(await findCountField('Tea · 2028-09')).toHaveValue('')
    expect(countField('Tea · No expiry')).toHaveValue('')
    expect(screen.getByText('Item 2 of 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous item' }))
    expect(await findCountField('Coffee · 2028-09')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Review count' }))
    const missing = screen.getByRole('region', { name: 'Still to count: 3' })
    await user.click(within(missing).getAllByRole('button')[2])
    expect(await findCountField('Tea · No expiry')).toHaveFocus()
    expect(queryCountField('Coffee · 2028-09')).not.toBeInTheDocument()
  })

  it.each(['en', 'ar'])('counts a non-carton pack and its loose contents using the recorded units (%s)', async language => {
    await i18n.changeLanguage(language)
    const units = {
      counting_unit_en: 'Packet', counting_unit_ar: 'باكيت',
      contains_qty: 10, contains_unit_en: 'Piece', contains_unit_ar: 'قطعة',
    }
    vi.mocked(api.getStoreCountExpected).mockResolvedValue([{ ...FIRST, ...units }])
    vi.mocked(api.listStorePickerItems).mockResolvedValue([{ ...ITEM, ...units }])
    vi.mocked(api.listStoreItems).mockResolvedValue([{ ...SHELF_ITEM, ...units }])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: i18n.t('assets.store.counts.start') }))
    const context = `${language === 'ar' ? FIRST.item_name_ar : FIRST.item_name_en} · 2028-09`
    const batch = within(await screen.findByRole('group', { name: context }))
    const packField = batch.getByRole('textbox', { name: new RegExp(language === 'ar' ? units.counting_unit_ar : units.counting_unit_en) })
    const looseField = batch.getByRole('textbox', { name: new RegExp(language === 'ar' ? units.contains_unit_ar : units.contains_unit_en) })
    expect(packField).toHaveValue('')
    expect(looseField).toHaveValue('')
    await user.type(packField, '2')
    await user.type(looseField, '3')
    await user.click(screen.getByRole('button', { name: i18n.t('assets.store.counts.review') }))
    expect(api.createStoreCount).not.toHaveBeenCalled()
    await user.click(screen.getByRole('checkbox', { name: i18n.t('assets.store.counts.confirmReview') }))
    await user.click(screen.getByRole('button', { name: i18n.t('assets.store.counts.save') }))
    await waitFor(() => expect(api.createStoreCount).toHaveBeenCalledWith({
      counted_on: todayIso(), note: null,
      lines: [{ item_id: FIRST.item_id, expiry: '2028-09', quantity: 23 }],
    }))
  })

  it.each([
    'assets.store.counts.review',
    'assets.store.counts.reviewAll',
    'assets.store.counts.skip',
  ])('moves keyboard focus into review when activated through %s', async action => {
    const user = userEvent.setup()
    renderPage()
    await start(user)
    const trigger = screen.getByRole('button', { name: i18n.t(action) })
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(trigger).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: i18n.t('assets.store.counts.reviewTitle') })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: i18n.t('assets.store.counts.continue') })).toHaveFocus()
    expect(api.createStoreCount).not.toHaveBeenCalled()
  })

  it('resumes operator-entered values after reload and after save-draft navigation, without submitting', async () => {
    const user = userEvent.setup()
    const first = renderPage()
    await start(user)
    await enter(user, '2028-09', '3', '5')
    await user.type(screen.getByLabelText('Note (optional)'), 'Checked top shelf')
    first.unmount()
    renderPage()
    expect(await findCountField('Tea · 2028-09')).toHaveValue('3')
    expect(countField('Tea · 2028-09', 'Loose: jar')).toHaveValue('5')
    expect(screen.getByLabelText('Note (optional)')).toHaveValue('Checked top shelf')
    await user.click(screen.getByRole('button', { name: 'Save draft & exit' }))
    await user.click(await screen.findByRole('link', { name: 'Open new count' }))
    expect(await findCountField('Tea · 2028-09')).toHaveValue('3')
    expect(api.createStoreCount).not.toHaveBeenCalled()
  })

  it('isolates drafts by signed-in operator and new versus edit count', async () => {
    const user = userEvent.setup()
    const first = renderPage()
    await start(user)
    await enter(user, '2028-09', '6')
    first.unmount()
    state.userId = 2
    const other = renderPage()
    await start(user)
    expect(await findCountField('Tea · 2028-09')).toHaveValue('')
    other.unmount()
    state.userId = 1
    const edit = renderPage('/holdings/store/counts/7')
    await start(user)
    expect(await findCountField('Tea · 2028-09')).toHaveValue('')
    expect(countField('Tea · No expiry')).toHaveValue('')
    expect(screen.getByLabelText('Note (optional)')).toHaveValue('')
    expect(screen.queryByDisplayValue('125')).not.toBeInTheDocument()
    edit.unmount()
    renderPage()
    expect(await findCountField('Tea · 2028-09')).toHaveValue('6')
  })

  it('keeps dates independent and reconciles a resumed draft against changed expected batches', async () => {
    const user = userEvent.setup()
    const first = renderPage()
    await start(user)
    await enter(user, '2028-09', '4')
    fireEvent.change(screen.getByLabelText('Counted on'), { target: { value: '2026-09-22' } })
    await start(user)
    expect(await findCountField('Tea · 2028-09')).toHaveValue('')
    await enter(user, '2028-09', '2')
    fireEvent.change(screen.getByLabelText('Counted on'), { target: { value: todayIso() } })
    expect(await findCountField('Tea · 2028-09')).toHaveValue('4')
    first.unmount()
    vi.mocked(api.getStoreCountExpected).mockResolvedValue([SECOND])
    const reconciled = renderPage()
    expect(await findCountField('Tea · No expiry')).toHaveValue('')
    expect(screen.getByLabelText('Counted on')).toHaveValue(todayIso())
    await waitFor(() => expect(JSON.parse(localStorage.getItem(countDraftKey(1, 'new', todayIso()))!).quantities).toEqual({}))
    reconciled.unmount()
    vi.mocked(api.getStoreCountExpected).mockResolvedValue([FIRST, SECOND])
    renderPage()
    expect(await findCountField('Tea · 2028-09')).toHaveValue('')
    expect(countField('Tea · 2028-09', 'Loose: jar')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Review count' }))
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(api.createStoreCount).not.toHaveBeenCalled()
  })

  it('distinguishes missing fields from an explicit zero and returns from illustrated review to the omitted batch', async () => {
    const user = userEvent.setup()
    renderPage()
    await start(user)
    await user.type(await findCountField('Tea · 2028-09'), '2')
    await user.click(screen.getByRole('button', { name: 'Review count' }))
    const missing = screen.getByRole('region', { name: 'Still to count: 2' })
    expect(within(missing).getAllByRole('button')).toHaveLength(2)
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save stock count' })).toBeDisabled()
    await user.click(within(missing).getAllByRole('button')[1])
    const blank = await findCountField('Tea · No expiry')
    expect(blank).toHaveFocus()
    await user.click(screen.getAllByRole('button', { name: 'Counted none' })[1])
    expect(blank).toHaveValue('0')
    expect(countField('Tea · No expiry', 'Loose: jar')).toHaveValue('0')
    await user.click(screen.getByRole('button', { name: 'Review count' }))
    expect(within(screen.getByRole('region', { name: 'Still to count: 1' })).getAllByRole('button')).toHaveLength(1)
    expect(within(screen.getByRole('region', { name: 'Your entered quantities' })).getByRole('button')).toHaveTextContent('0 cartons')
    expect(api.createStoreCount).not.toHaveBeenCalled()
  })

  it('reviews only entered quantities, lets the operator edit them, then saves real base-unit quantities and clears only this draft', async () => {
    const user = userEvent.setup()
    const { client } = renderPage()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await start(user)
    await enter(user, '2028-09', '3', '5')
    await enter(user, 'No expiry', '0')
    localStorage.setItem(countDraftKey(2, 'new', todayIso()), 'other operator draft')
    await user.click(screen.getByRole('button', { name: 'Review count' }))
    const entered = screen.getByRole('region', { name: 'Your entered quantities' })
    expect(within(entered).getAllByRole('button')[0]).toHaveTextContent('3 cartons + 5 jars')
    expect(screen.queryByText('900')).not.toBeInTheDocument()
    await user.click(within(entered).getAllByRole('button')[0])
    const quantity = await findCountField('Tea · 2028-09')
    await user.clear(quantity)
    await user.type(quantity, '4')
    await saveReview(user)
    await waitFor(() => expect(api.createStoreCount).toHaveBeenCalledWith({ counted_on: todayIso(), note: null, lines: [
      { item_id: 1, expiry: '2028-09', quantity: 101 }, { item_id: 1, expiry: null, quantity: 0 },
    ] }))
    expect(await screen.findByText('Counts destination')).toBeInTheDocument()
    expect(localStorage.getItem(countDraftKey(1, 'new', todayIso()))).toBeNull()
    expect(localStorage.getItem(countDraftKey(2, 'new', todayIso()))).toBe('other operator draft')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['store'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['store-dashboard'] })
  })

  it.each(['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'])('deduplicates added month expiry and its final day and submits the operator quantity (%s)', async zone => {
    const previous = process.env.TZ
    process.env.TZ = zone
    try {
      vi.mocked(api.getStoreCountExpected).mockResolvedValue([])
      const user = userEvent.setup()
      const first = renderPage()
      await start(user)
      await discoverItem(user)
      await user.click(screen.getByRole('radio', { name: 'Month only' }))
      fireEvent.change(screen.getByLabelText('Expiry month'), { target: { value: '2028-02' } })
      await user.click(screen.getByRole('button', { name: 'Add batch' }))
      await enter(user, '2028-02', '1')
      first.unmount()
      renderPage()
      expect(await findCountField('Tea · 2028-02')).toHaveValue('1')
      await user.click(screen.getByText('Found another expiry? Add a batch'))
      const fieldset = screen.getByText('Found another expiry? Add a batch').closest('details')!
      await user.click(within(fieldset).getByRole('radio', { name: 'Full date' }))
      fireEvent.change(within(fieldset).getByLabelText('Expiry date'), { target: { value: '2028-02-29' } })
      await user.click(within(fieldset).getByRole('button', { name: 'Add batch' }))
      expect(within(screen.getByRole('group', { name: 'Tea · 2028-02' })).getAllByRole('textbox', { name: new RegExp(ITEM.counting_unit_en) })).toHaveLength(1)
      await saveReview(user)
      await waitFor(() => expect(api.createStoreCount).toHaveBeenCalledWith({ counted_on: todayIso(), note: null, lines: [{ item_id: 1, expiry: '2028-02', quantity: 24 }] }))
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous }
  })

  it('uses current picker conversion when adding, rather than the item at selection time', async () => {
    vi.mocked(api.getStoreCountExpected).mockResolvedValue([])
    const user = userEvent.setup()
    const { client } = renderPage()
    await start(user)
    await discoverItem(user)
    act(() => { client.setQueryData(storeKeys.picker, [{ ...ITEM, contains_qty: 12 }]) })
    await user.click(screen.getByRole('radio', { name: 'No expiry' }))
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    await enter(user, 'No expiry', '1')
    await saveReview(user)
    await waitFor(() => expect(api.createStoreCount).toHaveBeenCalledWith({ counted_on: todayIso(), note: null, lines: [{ item_id: 1, expiry: null, quantity: 12 }] }))
  })

  it('rejects a selected item removed from the current picker before Add', async () => {
    vi.mocked(api.getStoreCountExpected).mockResolvedValue([])
    const user = userEvent.setup()
    const { client } = renderPage()
    await start(user)
    await discoverItem(user)
    act(() => { client.setQueryData(storeKeys.picker, []) })
    await user.click(screen.getByRole('radio', { name: 'No expiry' }))
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    expect(queryCountField('Tea · No expiry')).not.toBeInTheDocument()
    expect(api.createStoreCount).not.toHaveBeenCalled()
  })

  it('removes discovered batch values so re-adding never resurrects a quantity', async () => {
    vi.mocked(api.getStoreCountExpected).mockResolvedValue([])
    const user = userEvent.setup()
    renderPage()
    await start(user)
    await discoverItem(user)
    await user.click(screen.getByRole('radio', { name: 'No expiry' }))
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    await enter(user, 'No expiry', '3')
    await user.click(screen.getByRole('button', { name: 'Remove batch: Tea · No expiry' }))
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    expect(await findCountField('Tea · No expiry')).toHaveValue('')
  })

  it('retains extra saved batch identities but starts their quantities blank and replaces the saved record only after review', async () => {
    vi.mocked(api.getStoreCountExpected).mockResolvedValue([FIRST])
    const user = userEvent.setup()
    renderPage('/holdings/store/counts/7')
    await start(user)
    expect(await findCountField('Tea · No expiry')).toHaveValue('')
    await enter(user, '2028-09', '1')
    await enter(user, 'No expiry', '0')
    await saveReview(user)
    await waitFor(() => expect(api.updateStoreCount).toHaveBeenCalledWith(7, { counted_on: '2026-09-20', note: null, lines: [{ item_id: 1, expiry: '2028-09', quantity: 24 }, { item_id: 1, expiry: null, quantity: 0 }] }))
  })
  it('keeps entries and shows the error when refreshing the saved count fails', async () => {
    vi.mocked(api.getStoreCountExpected).mockResolvedValue([FIRST])
    const user = userEvent.setup()
    const { client } = renderPage('/holdings/store/counts/7')
    await start(user)
    await enter(user, '2028-09', '3')
    await user.type(screen.getByLabelText('Note (optional)'), 'Recounted')
    vi.mocked(api.getStoreCount).mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Server unavailable', {}))
    await act(() => client.refetchQueries({ queryKey: storeKeys.count(7) }))
    expect(await screen.findByText('The Store could not be loaded.')).toBeInTheDocument()
    expect(countField('Tea · 2028-09')).toHaveValue('3')
    expect(screen.getByLabelText('Note (optional)')).toHaveValue('Recounted')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByText('The Store could not be loaded.')).not.toBeInTheDocument())
    expect(countField('Tea · 2028-09')).toHaveValue('3')
    await enter(user, 'No expiry', '0')
    await saveReview(user)
    await waitFor(() => expect(api.updateStoreCount).toHaveBeenCalledWith(7, {
      counted_on: '2026-09-20', note: 'Recounted',
      lines: [{ item_id: 1, expiry: '2028-09', quantity: 72 }, { item_id: 1, expiry: null, quantity: 0 }],
    }))
  })


  it('resolves a server missing-batch race into illustrated review without exposing stock quantities', async () => {
    vi.mocked(api.getStoreCountExpected).mockResolvedValue([FIRST])
    vi.mocked(api.listStoreBatches).mockResolvedValue([{ ...SECOND, id: 11, on_hand: 9876, days_to_expiry: null }])
    vi.mocked(api.createStoreCount).mockRejectedValueOnce(new ApiError(422, 'STORE_COUNT_MISSING_BATCHES', 'msg', { batches: [{ batch_id: 11, item_code: 'ST-0001', expiry_date: null }] }))
    const user = userEvent.setup()
    renderPage()
    await start(user)
    await enter(user, '2028-09', '1')
    await saveReview(user)
    const missing = await screen.findByRole('region', { name: 'Still to count: 1' })
    expect(screen.queryByText(/9876/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save stock count' })).toBeDisabled()
    await user.click(within(missing).getByRole('button'))
    expect(await findCountField('Tea · No expiry')).toHaveValue('')
    await user.click(screen.getAllByRole('button', { name: 'Counted none' })[1])
    await saveReview(user)
    await waitFor(() => expect(api.createStoreCount).toHaveBeenLastCalledWith({ counted_on: todayIso(), note: null, lines: [{ item_id: 1, expiry: '2028-09', quantity: 24 }, { item_id: 1, expiry: null, quantity: 0 }] }))
  })

  it.each([
    ['network', new Error('Network unavailable')],
    ['server', new ApiError(500, 'INTERNAL_ERROR', 'msg', {})],
    ['month conflict', new ApiError(409, 'STORE_COUNT_MONTH_EXISTS', 'msg', { count_id: 7 })],
  ])('retains an acknowledged raced-batch count after a subsequent %s failure and retries without retyping', async (_kind, retryError) => {
    vi.mocked(api.getStoreCountExpected).mockResolvedValue([FIRST])
    vi.mocked(api.listStoreBatches).mockResolvedValue([{ ...SECOND, id: 11, on_hand: 9876, days_to_expiry: null }])
    vi.mocked(api.createStoreCount)
      .mockRejectedValueOnce(new ApiError(422, 'STORE_COUNT_MISSING_BATCHES', 'msg', { batches: [{ batch_id: 11, item_code: 'ST-0001', expiry_date: null }] }))
      .mockRejectedValueOnce(retryError)
    const user = userEvent.setup()
    renderPage()
    await start(user)
    await enter(user, '2028-09', '1')
    await saveReview(user)
    const missing = await screen.findByRole('region', { name: 'Still to count: 1' })
    await user.click(within(missing).getByRole('button'))
    await enter(user, 'No expiry', '2', '1')
    await saveReview(user)
    await waitFor(() => expect(api.createStoreCount).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked())
    expect(screen.getByRole('checkbox')).toBeEnabled()
    expect(screen.queryByRole('region', { name: /^Still to count/ })).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Your entered quantities' })).getAllByRole('button')).toHaveLength(2)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Save stock count' }))
    await waitFor(() => expect(api.createStoreCount).toHaveBeenNthCalledWith(3, {
      counted_on: todayIso(), note: null,
      lines: [{ item_id: 1, expiry: '2028-09', quantity: 24 }, { item_id: 1, expiry: null, quantity: 49 }],
    }))
  })

  it('counts with Arabic visible labels and reviews localized plural quantities before saving', async () => {
    await i18n.changeLanguage('ar')
    vi.mocked(api.getStoreCountExpected).mockResolvedValue([FIRST])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'بدء العد' }))
    const group = await screen.findByRole('group', { name: 'شاي · 2028-09' })
    await user.type(within(group).getByRole('textbox', { name: new RegExp(FIRST.counting_unit_ar) }), '٣')
    await user.type(within(group).getByRole('textbox', { name: 'مفرد: علبة' }), '٥')
    await user.click(screen.getByRole('button', { name: 'مراجعة الجرد' }))
    const entered = screen.getByRole('region', { name: 'الكميات التي أدخلتها' })
    expect(within(entered).getByRole('button')).toHaveTextContent(`${formatNumber(3, 'ar')} كراتين + ${formatNumber(5, 'ar')} علب`)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: i18n.t('assets.store.counts.save') }))
    await waitFor(() => expect(api.createStoreCount).toHaveBeenCalledWith({
      counted_on: todayIso(), note: null, lines: [{ item_id: 1, expiry: '2028-09', quantity: 77 }],
    }))
  })

  it('offers an actionable link after a backend month duplicate without losing the draft', async () => {
    vi.mocked(api.createStoreCount).mockRejectedValueOnce(new ApiError(409, 'STORE_COUNT_MONTH_EXISTS', 'msg', { count_id: 7 }))
    const user = userEvent.setup()
    renderPage()
    await start(user)
    await enter(user, '2028-09', '1')
    await enter(user, 'No expiry', '0')
    await saveReview(user)
    expect(await screen.findByRole('link', { name: 'Open the existing stock count' })).toHaveAttribute('href', '/holdings/store/counts/7')
    expect(localStorage.getItem(countDraftKey(1, 'new', todayIso()))).not.toBeNull()
  })

  it('warns truthfully when storage fails and refuses save-draft exit, while preserving entered values', async () => {
    const user = userEvent.setup()
    renderPage()
    await start(user)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable') })
    await enter(user, '2028-09', '2')
    await user.click(screen.getByRole('button', { name: 'Save draft & exit' }))
    expect(countField('Tea · 2028-09')).toHaveValue('2')
    fireEvent.change(screen.getByLabelText('Counted on'), { target: { value: '2026-09-22' } })
    expect(screen.getByLabelText('Counted on')).toHaveValue(todayIso())
    expect(countField('Tea · 2028-09')).toHaveValue('2')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Counts destination')).not.toBeInTheDocument()
  })

  it('explicitly discards only the active unfinished draft', async () => {
    const user = userEvent.setup()
    renderPage()
    await start(user)
    await enter(user, '2028-09', '5')
    localStorage.setItem(countDraftKey(1, 'new', '2026-08-01'), 'another date')
    const discardTrigger = screen.getByRole('button', { name: 'Discard this draft' })
    await user.click(discardTrigger)
    expect(screen.getByRole('heading', { name: 'Discard this date’s unfinished draft?' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Keep draft' }))
    expect(discardTrigger).toHaveFocus()
    expect(countField('Tea · 2028-09')).toHaveValue('5')
    await user.click(discardTrigger)
    await user.keyboard('{Escape}')
    expect(discardTrigger).toHaveFocus()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await user.click(discardTrigger)
    await user.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect(discardTrigger).toHaveFocus()
    expect(localStorage.getItem(countDraftKey(1, 'new', todayIso()))).toBeNull()
    expect(localStorage.getItem(countDraftKey(1, 'new', '2026-08-01'))).toBe('another date')
    await start(user)
    expect(await findCountField('Tea · 2028-09')).toHaveValue('')
  })
})
