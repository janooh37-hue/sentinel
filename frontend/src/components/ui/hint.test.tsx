import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Hint } from './hint'
import { IconAction } from './icon-action'
import { TooltipProvider } from './tooltip'

/** An explicit provider with zero delay so tooltips open immediately. */
function renderHint(ui: React.ReactElement, dir: 'ltr' | 'rtl' = 'ltr') {
  document.documentElement.dir = dir
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>)
}

afterEach(() => {
  document.documentElement.dir = ''
})

/** The visible, positioned tooltip surface (carries Radix's resolved `data-side`). */
function tooltipSurface(): HTMLElement {
  const surface = document.body.querySelector<HTMLElement>('[data-side]')
  if (!surface) throw new Error('tooltip is not open')
  return surface
}

describe('Hint', () => {
  it('sets aria-keyshortcuts on the trigger and never a title', () => {
    renderHint(
      <Hint label="Next record" shortcut="J">
        <button type="button">Next</button>
      </Hint>,
    )
    const btn = screen.getByRole('button', { name: 'Next' })
    expect(btn).toHaveAttribute('aria-keyshortcuts', 'J')
    expect(btn).not.toHaveAttribute('title')
  })

  it('opens a tooltip with the label and the shortcut on hover', async () => {
    const user = userEvent.setup()
    renderHint(
      <Hint label="Next record" shortcut="J">
        <button type="button">Next</button>
      </Hint>,
    )
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.hover(screen.getByRole('button', { name: 'Next' }))
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Next record')
    expect(tooltipSurface()).toHaveTextContent('J')
  })

  it('opens on keyboard focus and closes on Escape', async () => {
    const user = userEvent.setup()
    renderHint(
      <Hint label="Next record">
        <button type="button">Next</button>
      </Hint>,
    )
    await user.tab()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Next record')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it.each([
    ['ltr', 'start', 'left'],
    ['ltr', 'end', 'right'],
    ['rtl', 'start', 'right'],
    ['rtl', 'end', 'left'],
  ] as const)('dir=%s: side="%s" opens on the physical %s', async (dir, side, physical) => {
    const user = userEvent.setup()
    renderHint(
      <Hint label="Tip" side={side}>
        <button type="button">Go</button>
      </Hint>,
      dir,
    )
    await user.hover(screen.getByRole('button', { name: 'Go' }))
    await screen.findByRole('tooltip')
    expect(tooltipSurface()).toHaveAttribute('data-side', physical)
  })

  it('leaves physical and vertical sides alone under rtl', async () => {
    const user = userEvent.setup()
    renderHint(
      <Hint label="Tip" side="left">
        <button type="button">Go</button>
      </Hint>,
      'rtl',
    )
    await user.hover(screen.getByRole('button', { name: 'Go' }))
    await screen.findByRole('tooltip')
    expect(tooltipSurface()).toHaveAttribute('data-side', 'left')
  })

  it('keeps a child aria-keyshortcuts instead of overwriting it', () => {
    renderHint(
      <Hint label="Open" shortcut="Enter">
        <button type="button" aria-keyshortcuts="Control+Enter">
          Open
        </button>
      </Hint>,
    )
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Enter',
    )
  })

  it('shows the tooltip for a disabled button through a focusable wrapper', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    renderHint(
      <Hint label="Why not">
        <button type="button" disabled onClick={onClick}>
          Delete
        </button>
      </Hint>,
    )
    const btn = screen.getByRole('button', { name: 'Delete' })
    expect(btn).toBeDisabled()
    // Keyboard users reach the explanation through the wrapper (a disabled button takes no focus).
    await user.tab()
    expect(btn.parentElement).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Why not')
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('does not add a wrapper around an enabled trigger', () => {
    const { container } = renderHint(
      <Hint label="Go">
        <button type="button">Go</button>
      </Hint>,
    )
    expect(container.firstElementChild).toBe(screen.getByRole('button', { name: 'Go' }))
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
