import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { BookRead } from '@/lib/api'

import { WordSessionBanner } from './WordSessionBanner'

const active = {
  voided_at: null,
  edit_session: {
    state: 'active',
    user_id: 3,
    user_name: 'Mariam',
    created_at: '2026-10-04T10:00:00Z',
    last_put_at: '2026-10-04T10:20:00Z',
  },
} as unknown as BookRead

describe('WordSessionBanner', () => {
  it('renders nothing without an active session', () => {
    const { container } = render(
      <WordSessionBanner book={{ voided_at: null, edit_session: null } as unknown as BookRead} live={false} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('names the editor and explains the preview is the saved version', () => {
    render(<WordSessionBanner book={active} live={false} />)
    expect(screen.getByText('Being edited in Word by Mariam.')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent(/last saved version/)
  })

  it('has no toggle unless onToggleLive is given', () => {
    render(<WordSessionBanner book={active} live={false} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('toggle swaps its label with `live` and fires', async () => {
    const onToggleLive = vi.fn()
    const { rerender } = render(<WordSessionBanner book={active} live={false} onToggleLive={onToggleLive} />)
    await userEvent.click(screen.getByRole('button', { name: 'Show live draft' }))
    expect(onToggleLive).toHaveBeenCalledOnce()
    rerender(<WordSessionBanner book={active} live onToggleLive={onToggleLive} />)
    expect(screen.getByRole('button', { name: 'Show saved version' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('compact omits the editor line', () => {
    render(<WordSessionBanner book={active} compact live={false} />)
    expect(screen.queryByText('Being edited in Word by Mariam.')).toBeNull()
  })
})
