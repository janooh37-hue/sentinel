import { fireEvent, render, screen } from '@testing-library/react'
import { Printer } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

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
})
