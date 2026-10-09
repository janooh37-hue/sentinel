import { act, render, waitFor } from '@testing-library/react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import type { PdfDocLease } from '@/lib/pdfDocCache'

const { leasePdfUrlMock } = vi.hoisted(() => ({ leasePdfUrlMock: vi.fn() }))

vi.mock('@/lib/pdfDocCache', () => ({
  leasePdfUrl: leasePdfUrlMock,
  leasePdfBase64: vi.fn(),
  PdfFetchError: class PdfFetchError extends Error {
    status = 0
  },
}))

import DocPdfCanvas from './DocPdfCanvas'

function makeLease(): PdfDocLease & { release: Mock } {
  const doc = {
    numPages: 1,
    getPage: vi.fn().mockResolvedValue({
      getViewport: vi.fn(() => ({ width: 100, height: 100 })),
      render: vi.fn(() => ({ promise: Promise.resolve() })),
      cleanup: vi.fn(),
    }),
  } as unknown as PDFDocumentProxy
  return { doc, release: vi.fn() }
}

describe('DocPdfCanvas lifecycle', () => {
  beforeEach(() => {
    leasePdfUrlMock.mockReset()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('releases a lease that resolves after the component was unmounted', async () => {
    let resolveLease: (lease: PdfDocLease) => void = () => undefined
    leasePdfUrlMock.mockReturnValue(
      new Promise<PdfDocLease>((resolve) => {
        resolveLease = resolve
      }),
    )
    const lease = makeLease()
    const view = render(<DocPdfCanvas pdfUrl="/late.pdf" />)

    view.unmount()
    await act(async () => {
      resolveLease(lease)
      await Promise.resolve()
    })

    expect(lease.release).toHaveBeenCalledTimes(1)
  })

  it('releases the lease it holds exactly once when unmounted after loading', async () => {
    const lease = makeLease()
    leasePdfUrlMock.mockResolvedValue(lease)
    const view = render(<DocPdfCanvas pdfUrl="/held.pdf" />)
    await waitFor(() => expect(view.container.querySelector('[data-pdf-page]')).not.toBeNull())

    view.unmount()

    expect(lease.release).toHaveBeenCalledTimes(1)
  })

  it('observes the page wrapper once, across renders that pass a fresh inline renderOverlay', async () => {
    const observed: Element[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(el: Element): void {
          observed.push(el)
        }
        unobserve(): void {}
        disconnect(): void {}
      },
    )
    leasePdfUrlMock.mockResolvedValue(makeLease())
    const view = render(<DocPdfCanvas pdfUrl="/overlay.pdf" renderOverlay={() => null} />)
    await waitFor(() => expect(view.container.querySelector('[data-pdf-page]')).not.toBeNull())
    // The wrapper holds the PdfPages host; PdfPages' own observer watches the host itself.
    const wrapperObservations = (): number => observed.filter((el) => el.querySelector('[data-pdf-pages]') !== null).length
    expect(wrapperObservations()).toBe(1)

    view.rerender(<DocPdfCanvas pdfUrl="/overlay.pdf" renderOverlay={() => null} />)
    view.rerender(<DocPdfCanvas pdfUrl="/overlay.pdf" renderOverlay={() => null} />)

    expect(wrapperObservations()).toBe(1)
  })
})
