import { useState, type ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import * as Dialog from '@radix-ui/react-dialog'

import { ShortcutsHelpDialog } from '@/components/ui/shortcuts-help'
import { KeyboardShortcutsProvider } from './keyboardShortcuts'
import type { Handler, ShortcutAction } from './shortcutsContext'
import { useShortcutAction, useShortcutsContext } from './useKeyboardShortcuts'

function Probe({ action, handler }: { action: ShortcutAction; handler: Handler | null }): null {
  useShortcutAction(action, handler)
  return null
}

function HelpState(): React.JSX.Element {
  const { helpOpen } = useShortcutsContext()
  return <span data-testid="help">{helpOpen ? 'open' : 'closed'}</span>
}

function renderWith(ui: ReactNode) {
  return render(
    <KeyboardShortcutsProvider>
      <HelpState />
      {ui}
    </KeyboardShortcutsProvider>,
  )
}

/** Dispatches on `target`; returns false when the default was prevented. */
function press(init: KeyboardEventInit, target: Element | Window = document.body): boolean {
  return fireEvent.keyDown(target, init)
}

describe('bare-key layer', () => {
  it('dispatches J by KeyboardEvent.code even when key is the Arabic letter', () => {
    const next = vi.fn()
    renderWith(<Probe action="recordNext" handler={next} />)
    const notPrevented = press({ key: 'ت', code: 'KeyJ' })
    expect(next).toHaveBeenCalledTimes(1)
    expect(notPrevented).toBe(false)
  })

  it.each([
    ['KeyJ', 'recordNext'],
    ['KeyK', 'recordPrev'],
    ['KeyC', 'copyRef'],
    ['KeyF', 'focusDocument'],
    ['KeyS', 'signConfirm'],
    ['KeyM', 'toggleMark'],
    ['Equal', 'zoomIn'],
    ['NumpadAdd', 'zoomIn'],
    ['Minus', 'zoomOut'],
    ['NumpadSubtract', 'zoomOut'],
    ['Digit0', 'zoomFit'],
    ['Numpad0', 'zoomFit'],
    ['Enter', 'recordOpen'],
  ] as const)('%s → %s', (code, action) => {
    const fn = vi.fn()
    renderWith(<Probe action={action} handler={fn} />)
    press({ key: 'x', code })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does nothing in a textarea, input, or contenteditable', () => {
    const next = vi.fn()
    const esc = vi.fn()
    renderWith(
      <>
        <Probe action="recordNext" handler={next} />
        <Probe action="escape" handler={esc} />
        <textarea aria-label="note" />
        <input aria-label="q" />
        <div contentEditable suppressContentEditableWarning data-testid="ce" />
      </>,
    )
    for (const el of [screen.getByLabelText('note'), screen.getByLabelText('q')]) {
      press({ key: 'j', code: 'KeyJ' }, el)
      press({ key: 'Escape', code: 'Escape' }, el)
    }
    // jsdom does not implement isContentEditable; mirror what browsers report.
    const ce = screen.getByTestId('ce')
    Object.defineProperty(ce, 'isContentEditable', { value: true })
    press({ key: 'j', code: 'KeyJ' }, ce)
    expect(next).not.toHaveBeenCalled()
    expect(esc).not.toHaveBeenCalled()
  })

  it('does nothing with Ctrl, Meta or Alt held, or during IME composition', () => {
    const next = vi.fn()
    renderWith(<Probe action="recordNext" handler={next} />)
    press({ key: 'j', code: 'KeyJ', ctrlKey: true })
    press({ key: 'j', code: 'KeyJ', metaKey: true })
    press({ key: 'j', code: 'KeyJ', altKey: true })
    press({ key: 'j', code: 'KeyJ', isComposing: true })
    expect(next).not.toHaveBeenCalled()
  })

  it('does nothing while a Radix dialog is open, and resumes when it closes', () => {
    const next = vi.fn()
    function Page(): React.JSX.Element {
      const [open, setOpen] = useState(true)
      return (
        <>
          <Probe action="recordNext" handler={next} />
          <button type="button" onClick={() => setOpen(false)}>
            shut
          </button>
          <Dialog.Root open={open}>
            <Dialog.Portal>
              <Dialog.Content aria-describedby={undefined}>
                <Dialog.Title>t</Dialog.Title>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </>
      )
    }
    renderWith(<Page />)
    press({ key: 'j', code: 'KeyJ' })
    expect(next).not.toHaveBeenCalled()
    // Radix marks the rest of the page aria-hidden/inert; fire the click directly.
    act(() => {
      screen.getByRole('button', { name: 'shut', hidden: true }).click()
    })
    press({ key: 'j', code: 'KeyJ' })
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('does nothing while an [aria-modal=true] layer is present', () => {
    const next = vi.fn()
    renderWith(
      <>
        <Probe action="recordNext" handler={next} />
        <div aria-modal="true" role="presentation" />
      </>,
    )
    press({ key: 'j', code: 'KeyJ' })
    expect(next).not.toHaveBeenCalled()
  })

  it('does not re-fire one-shot actions on key repeat but does for J', () => {
    const next = vi.fn()
    const mark = vi.fn()
    renderWith(
      <>
        <Probe action="recordNext" handler={next} />
        <Probe action="toggleMark" handler={mark} />
      </>,
    )
    press({ key: 'j', code: 'KeyJ', repeat: true })
    press({ key: 'm', code: 'KeyM', repeat: true })
    expect(next).toHaveBeenCalledTimes(1)
    expect(mark).not.toHaveBeenCalled()
  })

  it('leaves Enter alone on a focused button or link', () => {
    const open = vi.fn()
    renderWith(
      <>
        <Probe action="recordOpen" handler={open} />
        <button type="button">go</button>
        <a href="/x">x</a>
      </>,
    )
    expect(press({ key: 'Enter', code: 'Enter' }, screen.getByText('go'))).toBe(true)
    press({ key: 'Enter', code: 'Enter' }, screen.getByText('x'))
    expect(open).not.toHaveBeenCalled()
    press({ key: 'Enter', code: 'Enter' })
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('Ctrl/⌘+Enter dispatches recordOpenNewTab, not recordOpen, and not from a textarea', () => {
    const open = vi.fn()
    const tab = vi.fn()
    renderWith(
      <>
        <Probe action="recordOpen" handler={open} />
        <Probe action="recordOpenNewTab" handler={tab} />
        <textarea aria-label="note" />
      </>,
    )
    press({ key: 'Enter', code: 'Enter', ctrlKey: true })
    press({ key: 'Enter', code: 'Enter', metaKey: true })
    press({ key: 'Enter', code: 'Enter', ctrlKey: true }, screen.getByLabelText('note'))
    expect(tab).toHaveBeenCalledTimes(2)
    expect(open).not.toHaveBeenCalled()
  })
})

describe('dispatch semantics', () => {
  it('falls through to the lower handler when the top returns false, and only prevents default when accepted', () => {
    const lower = vi.fn()
    const top = vi.fn(() => false)
    renderWith(
      <>
        <Probe action="recordNext" handler={lower} />
        <Probe action="recordNext" handler={top} />
      </>,
    )
    const notPrevented = press({ key: 'j', code: 'KeyJ' })
    expect(top).toHaveBeenCalledTimes(1)
    expect(lower).toHaveBeenCalledTimes(1)
    expect(notPrevented).toBe(false)
  })

  it('stops at the first handler that does not return false', () => {
    const lower = vi.fn()
    const top = vi.fn(() => true)
    renderWith(
      <>
        <Probe action="recordNext" handler={lower} />
        <Probe action="recordNext" handler={top} />
      </>,
    )
    press({ key: 'j', code: 'KeyJ' })
    expect(top).toHaveBeenCalledTimes(1)
    expect(lower).not.toHaveBeenCalled()
  })

  it('does not preventDefault when every handler declines', () => {
    renderWith(<Probe action="recordNext" handler={() => false} />)
    expect(press({ key: 'j', code: 'KeyJ' })).toBe(true)
  })

  it('does not preventDefault when nothing is registered', () => {
    renderWith(null)
    expect(press({ key: 'j', code: 'KeyJ' })).toBe(true)
  })

  it('a null handler declines and falls through', () => {
    const lower = vi.fn()
    renderWith(
      <>
        <Probe action="recordNext" handler={lower} />
        <Probe action="recordNext" handler={null} />
      </>,
    )
    press({ key: 'j', code: 'KeyJ' })
    expect(lower).toHaveBeenCalledTimes(1)
  })

  it('keeps the stack order across re-renders (new handler identities) and help toggles', () => {
    const calls: string[] = []
    function Tree({ n }: { n: number }): React.JSX.Element {
      return (
        <>
          <Probe action="recordNext" handler={() => void calls.push(`A${n}`)} />
          <Probe action="recordNext" handler={() => void calls.push(`B${n}`)} />
        </>
      )
    }
    const { rerender } = render(
      <KeyboardShortcutsProvider>
        <HelpState />
        <Tree n={1} />
      </KeyboardShortcutsProvider>,
    )
    press({ key: 'j', code: 'KeyJ' })
    for (const n of [2, 3]) {
      rerender(
        <KeyboardShortcutsProvider>
          <HelpState />
          <Tree n={n} />
        </KeyboardShortcutsProvider>,
      )
    }
    press({ key: 'j', code: 'KeyJ' })
    // Toggling help re-creates the context value; registrations must not move.
    press({ key: '/', code: 'Slash', ctrlKey: true })
    press({ key: '/', code: 'Slash', ctrlKey: true })
    press({ key: 'j', code: 'KeyJ' })
    // B is the later registrant, so it is on top and accepts; A never runs.
    expect(calls).toEqual(['B1', 'B3', 'B3'])
  })

  it('a conditionally declining top handler still reaches the same lower one after re-render', () => {
    const lower = vi.fn()
    const { rerender } = render(
      <KeyboardShortcutsProvider>
        <Probe action="recordNext" handler={lower} />
        <Probe action="recordNext" handler={() => false} />
      </KeyboardShortcutsProvider>,
    )
    rerender(
      <KeyboardShortcutsProvider>
        <Probe action="recordNext" handler={lower} />
        <Probe action="recordNext" handler={() => false} />
      </KeyboardShortcutsProvider>,
    )
    press({ key: 'j', code: 'KeyJ' })
    expect(lower).toHaveBeenCalledTimes(1)
  })
})

describe('escape', () => {
  it('dispatches the single escape resolver and prevents default when accepted', () => {
    const esc = vi.fn()
    renderWith(<Probe action="escape" handler={esc} />)
    expect(press({ key: 'Escape', code: 'Escape' })).toBe(false)
    expect(esc).toHaveBeenCalledTimes(1)
  })

  it('lets a declined Escape through (default not prevented)', () => {
    renderWith(<Probe action="escape" handler={() => false} />)
    expect(press({ key: 'Escape', code: 'Escape' })).toBe(true)
  })

  it('is skipped while a dialog is open', () => {
    const esc = vi.fn()
    renderWith(
      <>
        <Probe action="escape" handler={esc} />
        <div role="dialog" data-state="open" />
      </>,
    )
    press({ key: 'Escape', code: 'Escape' })
    expect(esc).not.toHaveBeenCalled()
  })

  it('is skipped while a Radix menu is open', () => {
    const esc = vi.fn()
    renderWith(
      <>
        <Probe action="escape" handler={esc} />
        <div role="menu" data-state="open" />
      </>,
    )
    press({ key: 'Escape', code: 'Escape' })
    expect(esc).not.toHaveBeenCalled()
  })
})

describe('help', () => {
  it('? opens the help sheet; Escape closes it without running the page resolver', () => {
    const esc = vi.fn()
    render(
      <KeyboardShortcutsProvider>
        <HelpState />
        <ShortcutsHelpDialog />
        <Probe action="escape" handler={esc} />
      </KeyboardShortcutsProvider>,
    )
    expect(screen.getByTestId('help')).toHaveTextContent('closed')
    press({ key: '?', code: 'Slash', shiftKey: true })
    expect(screen.getByTestId('help')).toHaveTextContent('open')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // Records section is listed.
    expect(screen.getByText('Records')).toBeInTheDocument()
    expect(screen.getByText('Next record')).toBeInTheDocument()
    press({ key: 'Escape', code: 'Escape' })
    expect(screen.getByTestId('help')).toHaveTextContent('closed')
    expect(esc).not.toHaveBeenCalled()
  })

  it('? also works when only e.key is "?" (non-US layout)', () => {
    renderWith(null)
    press({ key: '?', code: 'Digit7' })
    expect(screen.getByTestId('help')).toHaveTextContent('open')
  })

  it('? is ignored in editable targets', () => {
    renderWith(<input aria-label="q" />)
    press({ key: '?', code: 'Slash', shiftKey: true }, screen.getByLabelText('q'))
    expect(screen.getByTestId('help')).toHaveTextContent('closed')
  })

  it('a registered showHelpBare handler takes over from the built-in open', () => {
    const custom = vi.fn()
    renderWith(<Probe action="showHelpBare" handler={custom} />)
    press({ key: '?', code: 'Slash', shiftKey: true })
    expect(custom).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('help')).toHaveTextContent('closed')
  })
})

describe('existing modifier shortcuts', () => {
  it('Ctrl+K focuses search, including from an input', () => {
    const focus = vi.fn()
    renderWith(
      <>
        <Probe action="focusSearch" handler={focus} />
        <input aria-label="q" />
      </>,
    )
    expect(press({ key: 'k', code: 'KeyK', ctrlKey: true }, screen.getByLabelText('q'))).toBe(false)
    press({ key: 'K', code: 'KeyK', metaKey: true })
    expect(focus).toHaveBeenCalledTimes(2)
  })

  it('Ctrl+N dispatches newItem but not from an editable target', () => {
    const create = vi.fn()
    renderWith(
      <>
        <Probe action="newItem" handler={create} />
        <input aria-label="q" />
      </>,
    )
    press({ key: 'n', code: 'KeyN', ctrlKey: true }, screen.getByLabelText('q'))
    expect(create).not.toHaveBeenCalled()
    press({ key: 'n', code: 'KeyN', ctrlKey: true })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+/ toggles the help sheet', () => {
    renderWith(null)
    press({ key: '/', code: 'Slash', ctrlKey: true })
    expect(screen.getByTestId('help')).toHaveTextContent('open')
    press({ key: '/', code: 'Slash', ctrlKey: true })
    expect(screen.getByTestId('help')).toHaveTextContent('closed')
  })

  it('handlers that return undefined keep the old behaviour (accepted, default prevented)', () => {
    renderWith(<Probe action="focusSearch" handler={() => undefined} />)
    expect(press({ key: 'k', code: 'KeyK', ctrlKey: true })).toBe(false)
  })

  it('Ctrl+K with nothing registered does not prevent default', () => {
    renderWith(null)
    expect(press({ key: 'k', code: 'KeyK', ctrlKey: true })).toBe(true)
  })
})
