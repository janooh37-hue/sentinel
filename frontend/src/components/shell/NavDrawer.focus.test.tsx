import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: new Set(),
    isLoading: false,
    has: () => false,
  }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({ theme: 'light', font_scale: 16 }),
    updateSettings: vi.fn(),
  },
}))

import { NavDrawer } from './NavDrawer'

/** The phone shell in miniature: a menu button that opens the drawer, and the ref the drawer returns focus to. */
function Shell(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button type="button" ref={menuRef} onClick={() => setOpen(true)}>
        open menu
      </button>
      <NavDrawer open={open} onOpenChange={setOpen} returnFocusRef={menuRef} />
    </>
  )
}

function renderShell(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Shell />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

// Safari does not focus a <button> when it is tapped (touch, or a click without a prior focus), so
// `document.activeElement` is <body> when the drawer opens. Focus must still come back to the menu button.
describe('NavDrawer focus return', () => {
  it('returns focus to the menu button when opened by a tap that never focused it (Safari-like)', async () => {
    renderShell()
    const menu = screen.getByRole('button', { name: 'open menu' })
    fireEvent.click(menu) // a click event with no focus change, as a Safari tap produces
    expect(menu).not.toHaveFocus()
    const drawer = await screen.findByRole('dialog', { name: 'Menu' })
    // Radix moved focus inside the drawer on open.
    expect(drawer.contains(document.activeElement)).toBe(true)

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument())
    expect(menu).toHaveFocus()
  })

  it('returns focus to the menu button when closed with the Close button', async () => {
    renderShell()
    const menu = screen.getByRole('button', { name: 'open menu' })
    fireEvent.click(menu)
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument())
    expect(menu).toHaveFocus()
  })

  it('returns focus to the menu button when opened from the keyboard', async () => {
    renderShell()
    const user = userEvent.setup()
    await user.tab()
    expect(screen.getByRole('button', { name: 'open menu' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog', { name: 'Menu' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'open menu' })).toHaveFocus()
  })
})
