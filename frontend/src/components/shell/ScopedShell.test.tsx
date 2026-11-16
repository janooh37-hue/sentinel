import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import i18n from '@/lib/i18n'
import { BottomTabBar } from './BottomTabBar'
import { NavDrawer } from './NavDrawer'
import { TopNav } from './TopNav'

const session = vi.hoisted(() => ({ user: { role: 'operator', scoped_role: 'fleet_reporter' as 'fleet_reporter' | 'inmate_reporter' } }))
const capabilities = vi.hoisted(() => ({ vehicles: true }))
vi.mock('@/lib/authContext', async () => {
  // The mock factory is hoisted before static imports, so React must load inside it.
  const { createContext } = await import('react')
  return { AuthContext: createContext(session), useAuth: () => session }
})
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    isLoading: false,
    has: (cap: string) => cap !== 'vehicles.view' || capabilities.vehicles,
  }),
}))
vi.mock('@/lib/api', () => ({ api: { getSettings: vi.fn(), updateSettings: vi.fn() } }))
vi.mock('@/components/intake/IntakeLauncher', () => ({ IntakeLauncher: () => <span>intake</span> }))
vi.mock('./EmailBasketTray', () => ({ EmailBasketTray: () => <span>email</span> }))
vi.mock('./GatewayIndicator', () => ({ GatewayIndicator: () => <span>gateway</span> }))
vi.mock('./NavBellPopover', () => ({ NavBellPopover: () => <span>notifications</span> }))
vi.mock('./AccountMenu', () => ({ AccountMenu: () => <span>account</span> }))

beforeEach(() => {
  vi.clearAllMocks()
  session.user.scoped_role = 'fleet_reporter'
  capabilities.vehicles = true
})
afterEach(async () => {
  cleanup()
  document.documentElement.removeAttribute('dir')
  await i18n.changeLanguage('en')
})

const surfaces = {
  desktop: <TopNav onLock={vi.fn()} onOpenSettings={vi.fn()} />,
  drawer: <NavDrawer open onOpenChange={vi.fn()} />,
  dock: <BottomTabBar />,
}

describe.each(['en', 'ar'])('scoped navigation (%s)', (language) => {
  it.each(Object.keys(surfaces) as (keyof typeof surfaces)[])('keeps only fleet destinations in the %s', async (surface) => {
    await i18n.changeLanguage(language)
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter>{surfaces[surface]}</MemoryRouter></QueryClientProvider>)

    const nav = screen.getByRole('navigation')
    expect(within(nav).getAllByRole('link').map((link) => link.getAttribute('href')).sort()).toEqual(['/', '/books', '/services', '/vehicles'])
    expect(within(nav).getByRole('link', { name: i18n.t('nav.services') })).toHaveAttribute('href', '/services')
    expect(screen.queryByText('intake')).not.toBeInTheDocument()
    expect(screen.queryByText('email')).not.toBeInTheDocument()
    expect(Boolean(screen.queryByText('notifications'))).toBe(surface === 'desktop')
    expect(screen.queryByRole('link', { name: i18n.t('nav.settings') })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: i18n.t('nav.settings') })).not.toBeInTheDocument()
    expect(api.getSettings).not.toHaveBeenCalled()
  })

  it.each(Object.keys(surfaces) as (keyof typeof surfaces)[])('hides Vehicles without vehicles.view in the %s', async (surface) => {
    await i18n.changeLanguage(language)
    capabilities.vehicles = false
    const client = new QueryClient()
    render(<QueryClientProvider client={client}><MemoryRouter>{surfaces[surface]}</MemoryRouter></QueryClientProvider>)

    expect(screen.queryByRole('link', { name: i18n.t('nav.vehicles') })).not.toBeInTheDocument()
    expect(within(screen.getByRole('navigation')).getAllByRole('link').map((link) => link.getAttribute('href')).sort()).toEqual(['/', '/books', '/services'])
  })

  it.each(Object.keys(surfaces) as (keyof typeof surfaces)[])('preserves inmate-only labels and destinations in the %s', async (surface) => {
    await i18n.changeLanguage(language)
    session.user.scoped_role = 'inmate_reporter'
    const client = new QueryClient()
    render(<QueryClientProvider client={client}><MemoryRouter>{surfaces[surface]}</MemoryRouter></QueryClientProvider>)

    const nav = screen.getByRole('navigation')
    expect(within(nav).getAllByRole('link').map((link) => link.getAttribute('href')).sort()).toEqual(['/', '/books', '/services'])
    expect(within(nav).getByRole('link', { name: i18n.t('nav.inmateReport') })).toHaveAttribute('href', '/services')
    expect(screen.queryByText('notifications')).not.toBeInTheDocument()
  })
})
