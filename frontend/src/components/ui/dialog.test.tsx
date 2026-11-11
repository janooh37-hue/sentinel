import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DialogShell } from '@/components/forms/DialogShell'
import i18n from '@/lib/i18n'
import { ConfirmDialog } from './confirm-dialog'
import { DialogContent, DialogRoot, DialogTitle } from './dialog'
import { Sheet, SheetClose, SheetContent, SheetTitle } from './sheet'

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('ConfirmDialog autofocus', () => {
  it('focuses Cancel for destructive confirmation so Enter does not confirm', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="Delete record?" description="Cannot undo" confirmLabel="Delete" destructive onConfirm={onConfirm} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    await user.keyboard('{Enter}')
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps first-action autofocus for ordinary confirmation', async () => {
    render(<ConfirmDialog open onOpenChange={vi.fn()} title="Continue?" description="Review complete" onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus())
  })
})

function ControlledOverlay({ sheet = false, explicit = false }: { sheet?: boolean; explicit?: boolean }) {
  const [open, setOpen] = useState(false)
  const returnFocusRef = useRef<HTMLButtonElement>(null)
  return <>
    <button ref={returnFocusRef}>Stable return target</button>
    <button onClick={() => setOpen(true)}>Open editor</button>
    {sheet ? <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent returnFocusRef={explicit ? returnFocusRef : undefined} aria-describedby={undefined}>
        <SheetTitle>Editor</SheetTitle>
        <SheetClose>Close editor</SheetClose>
      </SheetContent>
    </Sheet> : open && <DialogShell open onOpenChange={setOpen} title="Editor" description="Edit record" returnFocusRef={explicit ? returnFocusRef : undefined}>
      <input aria-label="Name" />
    </DialogShell>}
  </>
}

describe('Controlled overlay focus return', () => {
  it.each([false, true])('returns focus to the opener after Escape (sheet=%s)', async (sheet) => {
    const user = userEvent.setup()
    render(<ControlledOverlay sheet={sheet} />)
    const opener = screen.getByRole('button', { name: 'Open editor' })
    await user.click(opener)
    expect(screen.getByRole('dialog', { name: 'Editor' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it.each([false, true])('prefers an explicit return target over captured focus (sheet=%s)', async (sheet) => {
    const user = userEvent.setup()
    render(<ControlledOverlay sheet={sheet} explicit />)
    const target = screen.getByRole('button', { name: 'Stable return target' })
    await user.click(screen.getByRole('button', { name: 'Open editor' }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(target).toHaveFocus())
  })

  it('honors an explicit close autofocus handler', async () => {
    const user = userEvent.setup()
    const target = document.createElement('button')
    document.body.append(target)
    const onCloseAutoFocus = vi.fn((event: Event) => {
      event.preventDefault()
      target.focus()
    })
    const { rerender } = render(<DialogRoot open><DialogContent aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}><DialogTitle>Editor</DialogTitle></DialogContent></DialogRoot>)
    await user.tab()
    rerender(<DialogRoot open={false}><DialogContent aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}><DialogTitle>Editor</DialogTitle></DialogContent></DialogRoot>)
    await waitFor(() => expect(target).toHaveFocus())
    expect(onCloseAutoFocus).toHaveBeenCalledOnce()
    target.remove()
  })
})
