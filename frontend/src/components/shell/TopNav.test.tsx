/**
 * TopNav — the contract CSS cannot state.
 *
 * Below the collapsed breakpoint the destination LABEL is hidden and the icon
 * becomes the only visible cue, so every link must carry both an icon and an
 * accessible name at all times. A link that renders text alone would go blank
 * on a 1280px laptop; one without an accessible name would go silent for a
 * screen reader. Both were real states of this header before the tiers landed.
 */

import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set(), isLoading: false, has: () => true }),
}))
vi.mock('@/lib/api', () => ({
  api: { getSettings: vi.fn().mockResolvedValue({ theme: 'light', font_scale: 16 }) },
}))
// Utility widgets own their own queries/streams; the header only has to place them.
vi.mock('@/components/intake/IntakeLauncher', () => ({
  IntakeLauncher: () => <button type="button">intake</button>,
}))
vi.mock('@/components/shell/EmailBasketTray', () => ({
  EmailBasketTray: () => <button type="button">baskets</button>,
}))
vi.mock('@/components/shell/GatewayIndicator', () => ({
  GatewayIndicator: () => <span>gateway</span>,
}))
vi.mock('@/components/shell/NavBellPopover', () => ({
  NavBellPopover: () => <button type="button">bell</button>,
}))
vi.mock('@/components/shell/AccountMenu', () => ({
  AccountMenu: () => <button type="button">account</button>,
}))

import { NAV_ITEMS } from '@/components/shell/navItems'
import { TopNav } from '@/components/shell/TopNav'

function renderNav() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <TopNav onLock={vi.fn()} onOpenSettings={vi.fn()} onSignOut={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('TopNav', () => {
  it('gives every destination an accessible name and an icon to collapse to', () => {
    renderNav()

    const nav = screen.getByRole('navigation', { name: 'Menu' })
    const links = Array.from(nav.querySelectorAll('a.topnav-link'))
    expect(links).toHaveLength(NAV_ITEMS.length)

    for (const link of links) {
      expect(link.getAttribute('aria-label')).toBeTruthy()
      expect(link.querySelector('.topnav-link-icon')).not.toBeNull()
      expect(link.querySelector('.topnav-link-label')?.textContent).toBeTruthy()
    }
  })

  it('keeps the collapsible brand copy and the utility cluster addressable', () => {
    renderNav()

    // The tiers hide these by class; the elements must exist to be hidden.
    expect(document.querySelector('.topnav-brand-copy')).not.toBeNull()
    expect(document.querySelector('.topnav-utilities')).not.toBeNull()
    expect(document.querySelector('[data-topnav-aa-range]')).not.toBeNull()
    expect(document.querySelector('[data-topnav-language-label]')).not.toBeNull()

    // Every action still renders, collapsed or not.
    for (const name of ['intake', 'baskets', 'bell', 'account']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })
})
