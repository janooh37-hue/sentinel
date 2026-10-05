import { fireEvent, render, screen } from '@testing-library/react'
import { Printer } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HeaderBtn } from './HeaderBtn'

describe('HeaderBtn', () => {
  it('renders icon-only controls with an accessible name and no title attribute', () => {
    render(<HeaderBtn icon={<Printer aria-hidden="true" />} label="Print" iconOnly />)

    const button = screen.getByRole('button', { name: 'Print' })
    expect(button).not.toHaveAttribute('title')
    expect(button).not.toHaveTextContent('Print')
  })

  it('allows a mobile primary action to grow', () => {
    render(<HeaderBtn icon={<Printer aria-hidden="true" />} label="Print" grow />)

    expect(screen.getByRole('button', { name: 'Print' })).toHaveClass('max-lg:flex-1')
  })

  it('keeps a reasoned button focusable, aria-disabled and inert', () => {
    const onClick = vi.fn()
    render(
      <HeaderBtn
        icon={<Printer aria-hidden="true" />}
        label="Revise"
        reason="Open the current version to revise."
        onClick={onClick}
      />,
    )
    const button = screen.getByRole('button', { name: 'Revise' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('swaps to the pending label with aria-busy and ignores clicks', () => {
    const onClick = vi.fn()
    render(
      <HeaderBtn
        icon={<Printer aria-hidden="true" />}
        label="Sign"
        pending
        pendingLabel="Signing…"
        onClick={onClick}
      />,
    )
    const button = screen.getByRole('button', { name: 'Signing…' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('exposes the shortcut via aria-keyshortcuts', () => {
    render(<HeaderBtn icon={<Printer aria-hidden="true" />} label="Mark up" shortcut="M" />)
    expect(screen.getByRole('button', { name: 'Mark up' })).toHaveAttribute('aria-keyshortcuts', 'M')
  })

  it('maps a display glyph to its ARIA key token', () => {
    render(<HeaderBtn icon={<Printer aria-hidden="true" />} label="Back" shortcut="Esc" />)
    expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute('aria-keyshortcuts', 'Escape')
  })

  it('drops aria-keyshortcuts while blocked or pending', () => {
    const { rerender } = render(
      <HeaderBtn icon={<Printer aria-hidden="true" />} label="Sign" shortcut="S" reason="Not yet." />,
    )
    expect(screen.getByRole('button', { name: 'Sign' })).not.toHaveAttribute('aria-keyshortcuts')
    rerender(<HeaderBtn icon={<Printer aria-hidden="true" />} label="Sign" shortcut="S" pending />)
    expect(screen.getByRole('button', { name: 'Sign' })).not.toHaveAttribute('aria-keyshortcuts')
  })

  describe('blocked reason on a hover-less wide screen (touch tablet)', () => {
    const realMatchMedia = window.matchMedia
    afterEach(() => {
      window.matchMedia = realMatchMedia
    })

    it('shows the reason inline when the primary pointer is coarse', () => {
      window.matchMedia = ((query: string) =>
        ({
          matches: query.includes('pointer: coarse'),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList) as typeof window.matchMedia
      render(<HeaderBtn icon={<Printer aria-hidden="true" />} label="Revise" reason="Open the current version." />)
      expect(screen.getByText('Open the current version.')).toBeVisible()
      expect(screen.getByRole('button', { name: 'Revise' })).toHaveAccessibleDescription('Open the current version.')
    })

    it('keeps the reason out of the layout for a fine pointer', () => {
      render(<HeaderBtn icon={<Printer aria-hidden="true" />} label="Revise" reason="Open the current version." />)
      expect(screen.queryByText('Open the current version.')).toBeNull()
    })
  })
})
