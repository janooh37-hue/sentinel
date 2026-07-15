import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SendConfirmDialog } from './SendConfirmDialog'

function renderIt(over: Partial<Parameters<typeof SendConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <SendConfirmDialog
      open
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      sending={false}
      text="Roster is out"
      chatName="Supervisors"
      mentionNames={[]}
      attachment={null}
      unfulfilled={null}
      groupCount={2}
      directCount={1}
      {...over}
    />,
  )
  return { onConfirm, onOpenChange }
}

describe('SendConfirmDialog', () => {
  it('previews the message and confirms', () => {
    const { onConfirm } = renderIt()
    expect(screen.getByText('Roster is out')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^send$|sendToGroup.confirmSend.send$/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('shows the upload warning and "send anyway" when unfulfilled', () => {
    const { onConfirm } = renderIt({ unfulfilled: 'upload' })
    expect(screen.getByText(/no file is attached|warnUpload/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /send anyway|sendAnywayFile/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('continue editing closes without confirming', () => {
    const { onConfirm, onOpenChange } = renderIt()
    fireEvent.click(screen.getByRole('button', { name: /continue editing|continueEditing/i }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
