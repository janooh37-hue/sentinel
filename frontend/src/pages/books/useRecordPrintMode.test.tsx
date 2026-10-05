import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useSearchParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getDocumentMock } = vi.hoisted(() => ({ getDocumentMock: vi.fn() }))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: getDocumentMock,
}))

import { clearPdfDocCache } from '@/lib/pdfDocCache'
import DocPdfCanvas from '@/pages/application/DocPdfCanvas'
import { installMockIntersectionObserver, setNearPages } from '@/test/mockIntersectionObserver'
import { useRecordPrint, useRecordPrintMode, useRecordPrintShortcut } from './useRecordPrintMode'

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

const PAGES = 13

/** The desk, reduced to what print routing touches: `?print=1` → eager canvas → onReady → print. */
function Desk({ withPdf }: { withPdf: boolean }) {
  const onPdfReady = useRecordPrintMode()
  const print = useRecordPrint()
  useRecordPrintShortcut()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  return (
    <>
      <button type="button" onClick={print}>
        Print
      </button>
      <output data-testid="search">{location.search}</output>
      <div data-record-paper>
        {withPdf ? (
          <DocPdfCanvas
            pdfUrl="/long.pdf"
            sizing="fit"
            bare
            eager={searchParams.get('print') === '1'}
            onReady={onPdfReady}
          />
        ) : (
          <img alt="scan" src="/scan.png" />
        )}
      </div>
    </>
  )
}

function renderDesk(withPdf: boolean, entry = '/books/42') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Desk withPdf={withPdf} />
    </MemoryRouter>,
  )
}

const canvasCount = (): number => document.querySelectorAll('canvas').length

describe('manual Print (useRecordPrint)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    getDocumentMock.mockReset()
    clearPdfDocCache()
    installMockIntersectionObserver()
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: PAGES,
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale })),
          render: vi.fn(() => ({ promise: Promise.resolve() })),
          cleanup: vi.fn(),
        }),
      }),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => 'AQ==' }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function loadDesk(): Promise<void> {
    await waitFor(() => expect(document.querySelectorAll('[data-pdf-page]')).toHaveLength(PAGES))
    setNearPages([1])
    await waitFor(() => expect(canvasCount()).toBe(1))
  }

  it('paints every page of a long PDF before it prints, then clears the print query', async () => {
    const painted: number[] = []
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {
      painted.push(canvasCount())
    })
    const user = userEvent.setup()
    renderDesk(true)
    await loadDesk()

    await user.click(screen.getByRole('button', { name: 'Print' }))

    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1))
    expect(painted).toEqual([PAGES])
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
  })

  it('prints again on a repeated Print', async () => {
    const painted: number[] = []
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {
      painted.push(canvasCount())
    })
    const user = userEvent.setup()
    renderDesk(true)
    await loadDesk()

    await user.click(screen.getByRole('button', { name: 'Print' }))
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
    await user.click(screen.getByRole('button', { name: 'Print' }))

    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(2))
    expect(painted).toEqual([PAGES, PAGES])
  })

  it('prints immediately when the desk shows no PDF', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const user = userEvent.setup()
    renderDesk(false)

    await user.click(screen.getByRole('button', { name: 'Print' }))

    expect(printSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('search').textContent).toBe('')
  })

  it('prints immediately and drops a stale print query when there is no PDF to wait for', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const user = userEvent.setup()
    renderDesk(false, '/books/42?print=1&version_id=3')

    await user.click(screen.getByRole('button', { name: 'Print' }))

    expect(printSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('search').textContent).toBe('?version_id=3')
  })

  describe('Ctrl+P / Cmd+P', () => {
    it('takes over the browser print: paints every page of a long PDF, then prints once', async () => {
      const painted: number[] = []
      const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {
        painted.push(canvasCount())
      })
      renderDesk(true)
      await loadDesk()

      // fireEvent returns false when a handler called preventDefault.
      expect(fireEvent.keyDown(window, { key: 'p', ctrlKey: true })).toBe(false)

      await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1))
      expect(painted).toEqual([PAGES])
      await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
    })

    it('also answers Cmd+P', async () => {
      const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined)
      renderDesk(true)
      await loadDesk()

      expect(fireEvent.keyDown(window, { key: 'P', metaKey: true })).toBe(false)

      await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1))
    })

    it('leaves other key combinations, repeats and handled events alone', () => {
      const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined)
      renderDesk(false)

      expect(fireEvent.keyDown(window, { key: 'p' })).toBe(true)
      expect(fireEvent.keyDown(window, { key: 'p', ctrlKey: true, shiftKey: true })).toBe(true)
      expect(fireEvent.keyDown(window, { key: 'p', ctrlKey: true, altKey: true })).toBe(true)
      expect(fireEvent.keyDown(window, { key: 'p', ctrlKey: true, metaKey: true })).toBe(true)
      expect(fireEvent.keyDown(window, { key: 'p', ctrlKey: true, repeat: true })).toBe(true)
      const handled = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, cancelable: true })
      handled.preventDefault()
      window.dispatchEvent(handled)

      expect(printSpy).not.toHaveBeenCalled()
    })

    it('prints immediately when the desk shows no PDF', () => {
      const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined)
      renderDesk(false)

      expect(fireEvent.keyDown(window, { key: 'p', ctrlKey: true })).toBe(false)

      expect(printSpy).toHaveBeenCalledTimes(1)
    })
  })
})
