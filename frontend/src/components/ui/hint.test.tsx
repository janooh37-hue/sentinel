import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Hint } from './hint'
import { IconAction } from './icon-action'

describe('Hint', () => {
  it('sets aria-keyshortcuts on the trigger and never a title', () => {
    render(
      <Hint label="Next record" shortcut="J">
        <button type="button">Next</button>
      </Hint>,
    )
    const btn = screen.getByRole('button', { name: 'Next' })
    expect(btn).toHaveAttribute('aria-keyshortcuts', 'J')
    expect(btn).not.toHaveAttribute('title')
  })
})

describe('IconAction', () => {
  it('maps pressed to aria-pressed and wires the shortcut', () => {
    render(
      <IconAction aria-label="Focus" pressed shortcut="F">
        <span aria-hidden="true">*</span>
      </IconAction>,
    )
    const btn = screen.getByRole('button', { name: 'Focus' })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn).toHaveAttribute('aria-keyshortcuts', 'F')
    expect(btn).not.toHaveAttribute('title')
  })

  it('omits aria-pressed when not a toggle and fires onClick', () => {
    const onClick = vi.fn()
    render(
      <IconAction aria-label="Delete" tone="danger" onClick={onClick}>
        <span aria-hidden="true">x</span>
      </IconAction>,
    )
    const btn = screen.getByRole('button', { name: 'Delete' })
    expect(btn).not.toHaveAttribute('aria-pressed')
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledOnce()
  })
})
