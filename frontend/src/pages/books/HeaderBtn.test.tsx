import { render, screen } from '@testing-library/react'
import { Printer } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import { HeaderBtn } from './HeaderBtn'

describe('HeaderBtn', () => {
  it('renders icon-only controls with an accessible tooltip label', () => {
    render(<HeaderBtn icon={<Printer aria-hidden="true" />} label="Print" iconOnly />)

    const button = screen.getByRole('button', { name: 'Print' })
    expect(button).toHaveAttribute('title', 'Print')
    expect(button).not.toHaveTextContent('Print')
  })

  it('allows a mobile primary action to grow', () => {
    render(<HeaderBtn icon={<Printer aria-hidden="true" />} label="Print" grow />)

    expect(screen.getByRole('button', { name: 'Print' })).toHaveClass('max-lg:flex-1')
  })
})
