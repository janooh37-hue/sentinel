import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, type StoreDashboard, type StoreItemRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { toast } from '@/lib/toast'
import { StoreDashboardPage } from './StoreDashboardPage'
import { canOpenHqMaterialRequest, openHqMaterialRequest } from './hqRequest'

const state = vi.hoisted(() => ({ mobile: false, editable: true, signedIn: true }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => state.mobile }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (capability: string) => capability === 'store.edit' && state.editable }) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: state.signedIn ? { name_en: 'Store keeper', name_ar: 'أمين المخزن', email: 'store@example.test' } : null }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('./hqRequest', () => ({ canOpenHqMaterialRequest: vi.fn(), openHqMaterialRequest: vi.fn() }))

const item = { item_id: 1, item_code: 'ST-0001', item_name_en: 'Tea', item_name_ar: 'شاي', counting_unit_en: 'Carton', counting_unit_ar: 'كرتون', contains_qty: 12, contains_unit_en: 'Jar', contains_unit_ar: 'علبة', art_kind: null, art_color: null }
const tea: StoreItemRead = { id: 1, code: item.item_code, name_en: 'Tea', name_ar: 'شاي', category_id: 1, category: { id: 1, name_en: 'Pantry', name_ar: 'ضيافة' }, counting_unit_en: 'Carton', counting_unit_ar: 'كرتون', contains_qty: 12, contains_unit_en: 'Jar', contains_unit_ar: 'علبة', art_kind: null, art_color: null, minimum_level: 48, archived_at: null, created_at: '2026-10-01T00:00:00Z', updated_at: null, on_hand: 16, version: '1' }
const water: StoreItemRead = { ...tea, id: 2, code: 'ST-0002', name_en: 'Water', name_ar: 'ماء', category_id: 2, category: { id: 2, name_en: 'Drinks', name_ar: 'مشروبات' }, minimum_level: null, contains_qty: null, on_hand: 3 }
const dashboard: StoreDashboard = {
  today: '2026-10-29', expiring_soon_days: 60,
  expired: [{ ...item, batch_id: 1, expiry_date: '2026-09-30', expiry_month_only: true, on_hand: 14, days_left: -29 }],
  expiring_soon: [{ ...item, batch_id: 2, expiry_date: '2026-11-10', expiry_month_only: false, on_hand: 2, days_left: 12 }],
  low_stock: [{ ...item, on_hand: 16, minimum_level: 48 }],
  usage: { months: ['2026-08', '2026-09', '2026-10'], rows: [{ ...item, values: [null, -2, 48] }] },
  suggestions: [{ ...item, average_usage: 23, on_hand: 16, suggested: 13, suggested_units: 2 }],
  last_count_on: '2026-10-20', last_delivery_on: '2026-10-21', counts_recorded: 4, usage_ready: true, suggestion_count: 1,
}
function renderPage(path = '/holdings/store') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter initialEntries={[path]}><StoreDashboardPage /></MemoryRouter></I18nextProvider></QueryClientProvider>)
  return client
}
beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  state.mobile = false
  state.editable = true
  state.signedIn = true
  await i18n.changeLanguage('en')
  vi.mocked(canOpenHqMaterialRequest).mockReturnValue(true)
  vi.spyOn(api, 'getStoreDashboard').mockResolvedValue(dashboard)
  vi.spyOn(api, 'listStoreItems').mockResolvedValue([tea, water])
  vi.spyOn(api, 'listStoreCategories').mockResolvedValue([tea.category, water.category])
  vi.spyOn(api, 'listStoreBatches').mockResolvedValue([
    ...dashboard.expired.map(batch => ({ ...batch, id: batch.batch_id, days_to_expiry: batch.days_left })),
    ...dashboard.expiring_soon.map(batch => ({ ...batch, id: batch.batch_id, days_to_expiry: batch.days_left })),
    { ...item, item_id: 2, id: 3, on_hand: 3, expiry_date: null, expiry_month_only: false, days_to_expiry: null },
  ])
  vi.spyOn(api, 'listStoreMovements').mockResolvedValue([])
  vi.spyOn(api, 'listStoreHandoverTakers').mockResolvedValue(['Rashid'])
  vi.spyOn(api, 'createStoreHandover').mockResolvedValue({ id: 4, handed_on: '2026-10-29', taken_by: 'Rashid', note: null, lines: [], created_by_user_id: 1, created_at: '2026-10-29T12:00:00Z', recorded_by_name: 'Store keeper', recorded_by_name_ar: null })
})

describe('Store dashboard', () => {
  it.each([false, true])('renders category shelves and badges, retaining usage and suggestions (mobile=%s)', async mobile => {
    state.mobile = mobile
    const user = userEvent.setup()
    renderPage()
    const pantry = await screen.findByRole('region', { name: 'Pantry' })
    expect(within(pantry).getByText('Expired')).toBeInTheDocument()
    expect(within(pantry).getByText('1 carton + 4 jars')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Drinks' })).toHaveTextContent('Water')
    expect(screen.getByRole('region', { name: 'Monthly usage' })).toHaveTextContent('−2 jars')
    expect(screen.getByRole('region', { name: 'Suggested request quantities' })).toHaveTextContent('2 cartons')
    await user.click(screen.getByRole('button', { name: '1 Below minimum' }))
    expect(screen.getByRole('button', { name: 'Water' })).toHaveClass('opacity-35')
    await user.click(screen.getByRole('button', { name: 'Tea' }))
    const dialog = screen.getByRole('dialog', { name: 'Tea' })
    expect(within(dialog).getByText('Low')).toBeInTheDocument()
    expect(within(dialog).getByText('12d')).toBeInTheDocument()
    expect(within(dialog).getByText(/Taken from the batch expiring 2026-11-10 first/)).toBeInTheDocument()
  })
  it('enters picking from a deep link, caps at non-expired stock, and removes at one', async () => {
    const user = userEvent.setup()
    renderPage('/holdings/store?pick=1')
    const button = await screen.findByRole('button', { name: 'Tea' })
    await user.click(button); await user.click(button); await user.click(button)
    const tray = screen.getByRole('region', { name: 'Handover' })
    expect(within(tray).getByLabelText('Increase Tea')).toBeDisabled()
    expect(within(tray).getByRole('status', { name: 'Tea' })).toHaveTextContent('2')
    await user.click(within(tray).getByLabelText('Decrease Tea')); await user.click(within(tray).getByLabelText('Decrease Tea'))
    expect(within(tray).getByText('Nothing added yet. Tap an item on a shelf.')).toBeInTheDocument()
  })
  it('disables items whose only remaining stock is expired', async () => {
    vi.mocked(api.listStoreBatches).mockResolvedValue(dashboard.expired.map(batch => ({ ...batch, id: batch.batch_id, days_to_expiry: batch.days_left })))
    renderPage('/holdings/store?pick=1')
    expect(await screen.findByRole('button', { name: 'Tea' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Water' })).toBeDisabled()
  })
  it('moves the drawer quantity into a multi-item handover', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Tea' }))
    await user.click(screen.getByLabelText('Increase Quantity'))
    await user.click(screen.getByRole('button', { name: /Add to a multi-item handover/ }))
    const tray = screen.getByRole('region', { name: 'Handover' })
    expect(within(tray).getByRole('status', { name: 'Tea' })).toHaveTextContent('2')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('posts all tray lines in one request, refreshes queries and exits picking', async () => {
    const user = userEvent.setup()
    const client = renderPage()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await user.click(screen.getByRole('button', { name: 'Hand out items' }))
    await user.click(await screen.findByRole('button', { name: 'Tea' }))
    await user.click(screen.getByRole('button', { name: 'Water' }))
    const tray = screen.getByRole('region', { name: 'Handover' })
    await user.type(within(tray).getByLabelText('Taken by'), 'Rashid')
    await user.type(within(tray).getByLabelText('Note (optional)'), 'Meeting')
    await user.click(within(tray).getByRole('button', { name: 'Record handover · 2 items' }))
    await waitFor(() => expect(api.createStoreHandover).toHaveBeenCalledTimes(1))
    expect(api.createStoreHandover).toHaveBeenCalledWith({ taken_by: 'Rashid', note: 'Meeting', lines: [{ item_id: 1, quantity: 1 }, { item_id: 2, quantity: 1 }] }, expect.anything())
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Handover' })).not.toBeInTheDocument())
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['store'] })
    expect(toast.success).toHaveBeenCalledWith('Recorded: 2 items handed to Rashid.')
  })
  it('records a single-item handover and validates the taker', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Tea' }))
    const dialog = screen.getByRole('dialog', { name: 'Tea' })
    await user.click(within(dialog).getByRole('button', { name: 'Record handover' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Enter the name')
    await user.type(within(dialog).getByLabelText('Taken by'), 'Rashid')
    await user.click(within(dialog).getByRole('button', { name: 'Record handover' }))
    await waitFor(() => expect(api.createStoreHandover).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.createStoreHandover).mock.calls[0][0].lines).toEqual([{ item_id: 1, quantity: 1 }])
  })
  it('keeps the tray and quantities after a short-stock error', async () => {
    vi.mocked(api.createStoreHandover).mockRejectedValue(new ApiError(422, 'STORE_HANDOVER_SHORT', 'short'))
    const user = userEvent.setup()
    renderPage('/holdings/store?pick=1')
    await user.click(await screen.findByRole('button', { name: 'Tea' }))
    await user.type(screen.getByLabelText('Taken by'), 'Rashid')
    await user.click(screen.getByRole('button', { name: 'Record handover · 1 item' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not enough non-expired stock')
    expect(screen.getByRole('region', { name: 'Handover' })).toBeInTheDocument()
  })
  it('does not offer hand-out forms or picking to a viewer', async () => {
    state.editable = false
    const user = userEvent.setup()
    renderPage('/holdings/store?pick=1')
    await user.click(await screen.findByRole('button', { name: 'Tea' }))
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hand out items' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Taken by')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record disposal' })).not.toBeInTheDocument()
  })
  it('opens an HQ request with positive whole-unit suggestions only', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Create HQ request' }))
    expect(openHqMaterialRequest).toHaveBeenCalledWith(expect.any(Function), [{ code: 'ST-0001', description: 'Tea', unit: 'Carton', qty: 2 }])
  })
  it('hides HQ requests without service permission', async () => {
    vi.mocked(canOpenHqMaterialRequest).mockReturnValue(false)
    renderPage()
    await screen.findByRole('region', { name: 'Pantry' })
    expect(screen.queryByRole('button', { name: 'Create HQ request' })).not.toBeInTheDocument()
  })
  it('explains the first-count state', async () => {
    vi.mocked(api.getStoreDashboard).mockResolvedValue({ ...dashboard, counts_recorded: 1, usage_ready: false, suggestion_count: 0, usage: { months: [], rows: [] }, suggestions: [], last_count_on: null, last_delivery_on: null })
    renderPage()
    expect(await screen.findByText('Needs a second count')).toBeInTheDocument()
    expect(screen.getAllByText('1 of 2 counts recorded')).toHaveLength(2)
    expect(screen.getByText(/Monthly usage will be available after two stock counts/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create HQ request' })).not.toBeInTheDocument()
  })
  it('directs an empty store to the Items tab', async () => {
    vi.mocked(api.listStoreItems).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('No store items yet')).toBeInTheDocument()
  })
  it('offers retry after a dashboard error', async () => {
    vi.mocked(api.getStoreDashboard).mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue(dashboard)
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: 'Pantry' })).toBeInTheDocument()
  })
  it.each([
    ['en', true, 'Recorded by Store keeper (you)'],
    ['en', false, 'Recorded by you'],
    ['ar', true, 'يسجّله أمين المخزن (أنت)'],
    ['ar', false, 'يسجّله أنت'],
  ] as const)('localizes the recorder without repeating you (%s, signedIn=%s)', async (language, signedIn, expected) => {
    state.signedIn = signedIn
    await i18n.changeLanguage(language)
    renderPage('/holdings/store?pick=1')
    expect(await screen.findByText(expected)).toBeInTheDocument()
    expect(screen.queryByText(/you \(you\)|أنت \(أنت\)/)).not.toBeInTheDocument()
  })
  it('renders Arabic shelves and the Arabic handover form', async () => {
    await i18n.changeLanguage('ar')
    const user = userEvent.setup()
    renderPage()
    const shelf = await screen.findByRole('region', { name: 'ضيافة' })
    expect(within(shelf).getByText('1 كرتون + 4 علبة')).toHaveAttribute('dir', 'auto')
    await user.click(screen.getByRole('button', { name: 'شاي' }))
    const dialog = screen.getByRole('dialog', { name: 'شاي' })
    expect(within(dialog).getByText('1 كرتون + 4 علبة')).toHaveAttribute('dir', 'auto')
    expect(within(dialog).getByText('4 كرتون')).toHaveAttribute('dir', 'auto')
    expect(within(dialog).getByText('2 كرتون')).toHaveAttribute('dir', 'auto')
    expect(within(dialog).getByText('1 كرتون + 11 علبة')).toHaveAttribute('dir', 'auto')
    expect(within(dialog).getByLabelText('زيادة الكمية')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('إنقاص الكمية')).toBeDisabled()
    expect(screen.getByLabelText('المستلم')).toBeInTheDocument()
    const addMulti = screen.getByRole('button', { name: 'إضافة إلى صرف متعدد' })
    expect(addMulti.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    await user.click(addMulti)
    const tray = screen.getByRole('region', { name: 'صرف' })
    expect(within(tray).getByText('1 علبة')).toHaveAttribute('dir', 'auto')
    expect(within(tray).getByLabelText('زيادة شاي')).toBeInTheDocument()
    expect(within(tray).getByLabelText('إنقاص شاي')).toBeInTheDocument()
  })
  it('does not force an Arabic no-expiry label into an LTR run', async () => {
    await i18n.changeLanguage('ar')
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'ماء' }))
    const dialog = screen.getByRole('dialog', { name: 'ماء' })
    expect(within(dialog).getByText(i18n.t('assets.store.expiry.none'))).toHaveAttribute('dir', 'auto')
  })
})
