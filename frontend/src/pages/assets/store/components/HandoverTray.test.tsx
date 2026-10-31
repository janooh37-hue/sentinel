import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, type StoreHandoverRead, type StoreItemRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { HandoverForm, HandoverTray } from './HandoverTray'

vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const tea: StoreItemRead = {
  id: 1, code: 'ST-0001', name_en: 'Tea', name_ar: 'شاي', category_id: 1,
  category: { id: 1, name_en: 'Pantry', name_ar: 'ضيافة' }, counting_unit_en: 'Carton', counting_unit_ar: 'كرتون',
  contains_qty: null, contains_unit_en: null, contains_unit_ar: null, art_kind: null, art_color: null,
  minimum_level: null, archived_at: null, created_at: '2026-10-01T00:00:00Z', updated_at: null, on_hand: 4, version: '1',
}
const trayProps = { items: [tea], maximum: () => 4, onChange: vi.fn(), onCancel: vi.fn(), onSuccess: vi.fn(), busyChanged: vi.fn(), busy: false }
function renderWithClient(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}>{children}</I18nextProvider></QueryClientProvider>)
}

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listStoreHandoverTakers').mockResolvedValue([])
})
afterEach(() => vi.unstubAllGlobals())

describe('Handover tray', () => {
  it('stays collapsed with its shelf hint and cancel until the first item is added', async () => {
    const user = userEvent.setup()
    renderWithClient(<HandoverTray {...trayProps} picked={{}} />)
    const tray = screen.getByRole('region', { name: 'Handover' })
    expect(within(tray).getByText('Nothing added yet. Tap an item on a shelf.')).toBeInTheDocument()
    expect(within(tray).queryByRole('form')).not.toBeInTheDocument()
    expect(within(tray).queryByLabelText('Taken by')).not.toBeInTheDocument()
    expect(within(tray).queryByRole('button', { name: /Record handover/ })).not.toBeInTheDocument()
    await user.click(within(tray).getByRole('button', { name: 'Cancel' }))
    expect(trayProps.onCancel).toHaveBeenCalledOnce()
  })

  it.each([false, true])('shows Recording… and aria-busy until submission settles (multi=%s)', async multi => {
    let finish!: (value: StoreHandoverRead) => void
    vi.spyOn(api, 'createStoreHandover').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const user = userEvent.setup()
    renderWithClient(<HandoverForm multi={multi} lines={[{ item_id: 1, quantity: 1 }]} onSuccess={vi.fn()} />)
    const form = screen.getByRole('form', { name: 'Hand out' })
    await user.type(within(form).getByLabelText('Taken by'), 'Rashid')
    await user.click(within(form).getByRole('button', { name: multi ? 'Record handover · 1 item' : 'Record handover' }))
    expect(await within(form).findByRole('button', { name: 'Recording…' })).toBeDisabled()
    expect(form).toHaveAttribute('aria-busy', 'true')
    await act(async () => finish({ id: 1, handed_on: '2026-10-31', taken_by: 'Rashid', note: null, lines: [], created_by_user_id: 1, created_at: '2026-10-31T12:00:00Z', recorded_by_name: null, recorded_by_name_ar: null }))
    await waitFor(() => expect(form).toHaveAttribute('aria-busy', 'false'))
    expect(within(form).queryByRole('button', { name: 'Recording…' })).not.toBeInTheDocument()
  })

  it('localizes the pending label in Arabic', async () => {
    await i18n.changeLanguage('ar')
    vi.spyOn(api, 'createStoreHandover').mockImplementation(() => new Promise(() => {}))
    const user = userEvent.setup()
    renderWithClient(<HandoverForm lines={[{ item_id: 1, quantity: 1 }]} onSuccess={vi.fn()} />)
    await user.type(screen.getByLabelText('المستلم'), 'راشد')
    await user.click(screen.getByRole('button', { name: 'تسجيل الصرف' }))
    expect(await screen.findByRole('button', { name: 'جارٍ تسجيل الصرف…' })).toBeDisabled()
    expect(screen.getByRole('form')).toHaveAttribute('aria-busy', 'true')
  })

  it('reserves the measured tray obstruction on the dashboard scroller and restores it on close', () => {
    let resize!: () => void
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = () => callback([], this) }
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    let trayHeight = 200
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('aria-label') === 'Handover' ? new DOMRect(0, 800 - trayHeight, 390, trayHeight) : new DOMRect(0, 0, 390, 800)
    })
    const view = renderWithClient(<div data-testid="scroller" style={{ overflowY: 'auto', paddingBlockEnd: '24px', scrollPaddingBlockEnd: '8px' }}><HandoverTray {...trayProps} picked={{}} /></div>)
    const scroller = screen.getByTestId('scroller')
    expect(scroller.style.paddingBlockEnd).toBe('236px')
    expect(scroller.style.scrollPaddingBlockEnd).toBe('212px')
    trayHeight = 400
    act(() => resize())
    expect(scroller.style.paddingBlockEnd).toBe('436px')
    expect(scroller.style.scrollPaddingBlockEnd).toBe('412px')
    view.unmount()
    expect(scroller.style.paddingBlockEnd).toBe('24px')
    expect(scroller.style.scrollPaddingBlockEnd).toBe('8px')
  })

  it('tracks the on-screen keyboard viewport and reveals focused inputs above its sticky actions', async () => {
    const viewport = Object.assign(new EventTarget(), { height: 500, offsetTop: 0 })
    vi.stubGlobal('visualViewport', viewport)
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    const user = userEvent.setup()
    renderWithClient(<HandoverTray {...trayProps} picked={{ 1: 1 }} />)
    const tray = screen.getByRole('region', { name: 'Handover' })
    expect(tray.style.getPropertyValue('--handover-viewport-height')).toBe('500px')
    expect(tray.style.getPropertyValue('--handover-keyboard-offset')).toBe(`${window.innerHeight - 500}px`)
    await user.click(within(tray).getByLabelText('Note (optional)'))
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' }))
    expect(within(tray).getByRole('button', { name: 'Record handover · 1 item' }).parentElement).toHaveClass('sticky', 'bottom-0')
    viewport.height = 350
    act(() => viewport.dispatchEvent(new Event('resize')))
    expect(tray.style.getPropertyValue('--handover-viewport-height')).toBe('350px')
    expect(tray.style.getPropertyValue('--handover-keyboard-offset')).toBe(`${window.innerHeight - 350}px`)
  })
})
