import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ApiModule from '@/lib/api'
import { api } from '@/lib/api'
import { BASKET_KEY, type EmailBasketItem } from '@/lib/emailBasket'
import { EmailBasketTray } from './EmailBasketTray'

const { capabilities } = vi.hoisted(() => ({ capabilities: new Set<string>() }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => capabilities.has(cap) }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
vi.mock('@/lib/messageTemplates', () => ({ useDraftTemplates: () => ({ data: undefined }) }))
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof ApiModule>()
  return { ...real, api: { ...real.api, getBook: vi.fn().mockRejectedValue(new Error('offline')) } }
})

const item: EmailBasketItem = {
  bookId: 48, docId: 900, ref: 'GS-0048', employeeId: 'G100', nameEn: 'John Doe',
  nameAr: null, formKind: 'General Book', detail: 'Transfer letter',
}
function LocationProbe() {
  const location = useLocation()
  return <output data-testid="route">{JSON.stringify({ path: location.pathname, state: location.state })}</output>
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = () => <QueryClientProvider client={client}><MemoryRouter><EmailBasketTray /><LocationProbe /></MemoryRouter></QueryClientProvider>
  const view = render(tree())
  return () => view.rerender(tree())
}
beforeEach(() => {
  capabilities.clear()
  vi.clearAllMocks()
  localStorage.clear()
  localStorage.setItem(BASKET_KEY, JSON.stringify({ 'General Book': [item] }))
})

describe('EmailBasketTray send boundary', () => {
  it('keeps baskets removable but disables compose without ledger.send, independently of ledger.create', async () => {
    capabilities.add('ledger.create')
    const refresh = mount()
    await userEvent.click(screen.getByRole('button', { name: 'basket.tray.title' }))
    const send = await screen.findByRole('button', { name: 'basket.tray.send' })
    expect(send).toBeDisabled()
    expect(send).toHaveAttribute('title', 'common.forbidden')
    expect(screen.getByRole('button', { name: 'basket.tray.remove' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'basket.tray.clear' })).toBeEnabled()
    await userEvent.click(send)
    expect(api.getBook).not.toHaveBeenCalled()
    expect(screen.getByTestId('route')).not.toHaveTextContent('composePrefill')
    capabilities.add('ledger.send')
    refresh()
    await userEvent.click(screen.getByRole('button', { name: 'basket.tray.send' }))
    await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('composePrefill'))
    expect(screen.getByTestId('route')).toHaveTextContent('/ledger')
    expect(api.getBook).toHaveBeenCalledWith(48)
  })

  it('rechecks send when an already-rendered basket action is invoked', async () => {
    capabilities.add('ledger.send')
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'basket.tray.title' }))
    const send = await screen.findByRole('button', { name: 'basket.tray.send' })
    capabilities.delete('ledger.send')
    await userEvent.click(send)
    expect(api.getBook).not.toHaveBeenCalled()
    expect(screen.getByTestId('route')).not.toHaveTextContent('composePrefill')
  })
})
