import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRecordPrintMode } from './useRecordPrintMode'

function Harness() {
  const print = useRecordPrintMode()
  const location = useLocation()

  return (
    <>
      <button type="button" onClick={print}>
        Print
      </button>
      <output data-testid="search">{location.search}</output>
    </>
  )
}

describe('useRecordPrintMode', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('prints once and removes the print query when requested', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/books/42?print=1']}>
        <Harness />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Print' }))
    await user.click(screen.getByRole('button', { name: 'Print' }))

    expect(printSpy).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
  })

  it('does not print without the print query', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/books/42']}>
        <Harness />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Print' }))

    expect(printSpy).not.toHaveBeenCalled()
  })
})
