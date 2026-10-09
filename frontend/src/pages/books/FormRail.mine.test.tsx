/**
 * FormRail — the "Created by me" toggle (full row, icon cell, drawer-tier chip)
 * and the icon tier, whose cells stay named by their service.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))

import { FormRail, MineChip, type RailItem } from './FormRail'

const items: RailItem[] = [
  { serviceId: 'all', glyph: '•', label: 'All forms', count: 10, states: [] },
  { serviceId: 'General Book', glyph: 'G', label: 'General Book', count: 7, states: ['pending'] },
]

describe('FormRail "Created by me"', () => {
  it('toggles from the top of the full rail, with a count badge', async () => {
    const onToggle = vi.fn()
    render(
      <FormRail
        items={items}
        active="all"
        onChange={vi.fn()}
        mine={{ pressed: false, count: 4, onToggle }}
      />,
    )
    const toggle = screen.getByRole('button', { name: /Created by me/ })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toHaveTextContent('4')
    // It is the first control in the rail.
    expect(screen.getAllByRole('button')[0]).toBe(toggle)

    await userEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('reports the pressed state, and renders nothing when the page passes no toggle', () => {
    const { rerender } = render(
      <FormRail
        items={items}
        active="all"
        onChange={vi.fn()}
        mine={{ pressed: true, count: null, onToggle: vi.fn() }}
      />,
    )
    expect(screen.getByRole('button', { name: /Created by me/ })).toHaveAttribute('aria-pressed', 'true')

    rerender(<FormRail items={items} active="all" onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Created by me/ })).not.toBeInTheDocument()
  })

  it('icon tier: cells are named by service and count, and the toggle keeps its name', async () => {
    const onChange = vi.fn()
    render(
      <FormRail
        items={items}
        active="all"
        onChange={onChange}
        tier="icons"
        mine={{ pressed: false, count: 4, onToggle: vi.fn() }}
      />,
    )
    expect(document.querySelector('[data-records-rail]')).toHaveAttribute('data-rail-tier', 'icons')
    expect(screen.getByRole('button', { name: /Created by me/ })).toBeInTheDocument()
    const cell = screen.getByRole('button', { name: /General Book/ })
    expect(cell).toHaveTextContent('7')
    await userEvent.click(cell)
    expect(onChange).toHaveBeenCalledWith('General Book')
  })

  it('chip variant (drawer tier) is a pressed-state button too', () => {
    render(<MineChip pressed count={2} onToggle={vi.fn()} variant="chip" />)
    const chip = screen.getByRole('button', { name: /Created by me/ })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(chip).toHaveTextContent('2')
  })
})
