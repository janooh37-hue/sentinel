import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { LedgerPaperFrame } from './LedgerPaperFrame'

afterEach(cleanup)

it('T-C7 frames the draft paper in a sandbox that runs no scripts', () => {
  render(<LedgerPaperFrame source={{ draftId: 12 }} />)
  const frame = screen.getByTitle('Ledger Book paper')
  expect(frame.tagName).toBe('IFRAME')
  expect(frame).toHaveAttribute('src', '/api/v1/ledger/drafts/12/paper')
  const sandbox = frame.getAttribute('sandbox') ?? ''
  expect(sandbox.split(' ')).toContain('allow-same-origin')
  expect(sandbox).not.toContain('allow-scripts')
})

it('T-C7 frames an issued book, latest or a chosen Revision', () => {
  const { rerender } = render(<LedgerPaperFrame source={{ bookId: 40 }} />)
  expect(screen.getByTitle('Ledger Book paper')).toHaveAttribute('src', '/api/v1/ledger/books/40/paper')
  rerender(<LedgerPaperFrame source={{ bookId: 40, revision: 77 }} />)
  expect(screen.getByTitle('Ledger Book paper')).toHaveAttribute('src', '/api/v1/ledger/books/40/paper?revision=77')
  expect(screen.getByTitle('Ledger Book paper')).toHaveAttribute('sandbox')
})

it('T-F5 fits the whole natural A4 page to both panel dimensions and resizes', () => {
  let resize: ResizeObserverCallback = () => {}
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = callback }
    observe() {}
    disconnect() {}
  })
  render(<LedgerPaperFrame source={{ draftId: 12 }} />)
  const frame = screen.getByTitle('Ledger Book paper')
  act(() => resize([{ contentRect: { width: 600, height: 561.25 } }] as ResizeObserverEntry[], {} as ResizeObserver))
  expect(frame).toHaveStyle({ width: '793.7px', height: '1122.5px', transform: 'scale(0.5)' })
  act(() => resize([{ contentRect: { width: 198.425, height: 1000 } }] as ResizeObserverEntry[], {} as ResizeObserver))
  expect(frame).toHaveStyle({ transform: 'scale(0.25)' })
  vi.unstubAllGlobals()
})
