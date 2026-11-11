import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import '@/lib/i18n'
import { ConfirmDialog } from './confirm-dialog'

afterEach(cleanup)

const open = (props: Partial<React.ComponentProps<typeof ConfirmDialog>>): void => {
  render(<ConfirmDialog open onOpenChange={vi.fn()} title="Sure?" confirmLabel="Do it" onConfirm={vi.fn()} {...props} />)
}

it('keeps initial focus on the confirm button by default', async () => {
  open({})
  expect(await screen.findByRole('button', { name: 'Do it' })).toHaveFocus()
})

it('a destructive confirmation starts on Cancel', async () => {
  open({ destructive: true })
  expect(await screen.findByRole('button', { name: 'Cancel' })).toHaveFocus()
})

it('focusCancel opts an irreversible, non-destructive confirmation into the same, and can opt a destructive one out', async () => {
  open({ focusCancel: true })
  expect(await screen.findByRole('button', { name: 'Cancel' })).toHaveFocus()
  cleanup()
  open({ destructive: true, focusCancel: false })
  expect(await screen.findByRole('button', { name: 'Do it' })).toHaveFocus()
})
