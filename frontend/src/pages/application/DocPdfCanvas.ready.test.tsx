import { fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDocumentMock } = vi.hoisted(() => ({
  getDocumentMock: vi.fn(),
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: getDocumentMock,
}))

import { clearPdfDocCache } from '@/lib/pdfDocCache'
import DocPdfCanvas from './DocPdfCanvas'

describe('DocPdfCanvas readiness', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    getDocumentMock.mockReset()
    clearPdfDocCache()
  })

  it('calls onReady once after every page finishes painting', async () => {
    let root: HTMLElement | null = null
    let spinnerPresentAtReady: boolean | null = null
    const onReady = vi.fn(() => {
      spinnerPresentAtReady = root?.querySelector('.animate-spin') !== null
    })
    const renderPage = vi.fn(() => ({ promise: Promise.resolve() }))
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn(() => ({ width: 100, height: 100 })),
          render: renderPage,
          cleanup: vi.fn(),
        }),
      }),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => 'AQ==' }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)

    const view = render(<DocPdfCanvas pdfUrl="/document.pdf" onReady={onReady} />)
    root = view.container

    await waitFor(() => expect(view.container.querySelector('canvas')).not.toBeNull())
    expect(renderPage).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
    expect(spinnerPresentAtReady).toBe(false)
  })

  it('renders supplied base64 PDF bytes without making a download request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn(() => ({ width: 100, height: 100 })),
          render: vi.fn(() => ({ promise: Promise.resolve() })),
          cleanup: vi.fn(),
        }),
      }),
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D,
    )

    const view = render(<DocPdfCanvas pdfBase64="AQ==" sourceKey="preview-1" />)

    await waitFor(() => expect(view.container.querySelector('canvas')).not.toBeNull())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getDocumentMock).toHaveBeenCalledWith({
      data: new Uint8Array([1]),
      disableFontFace: true,
    })
  })

  it('calls onReady again after a changed PDF URL finishes painting', async () => {
    const onReady = vi.fn()
    const renderPage = vi.fn(() => ({ promise: Promise.resolve() }))
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn(() => ({ width: 100, height: 100 })),
          render: renderPage,
          cleanup: vi.fn(),
        }),
      }),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => 'AQ==' }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)

    const view = render(<DocPdfCanvas pdfUrl="/first.pdf" onReady={onReady} />)
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))

    view.rerender(<DocPdfCanvas pdfUrl="/second.pdf" onReady={onReady} />)
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(2))
    expect(renderPage).toHaveBeenCalledTimes(2)
  })

  it('does not call onReady when the PDF request fails', async () => {
    const onReady = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const view = render(<DocPdfCanvas pdfUrl="/document.pdf" onReady={onReady} />)

    await waitFor(() => expect(view.getByText('Couldn’t render this PDF')).toBeInTheDocument())
    expect(onReady).not.toHaveBeenCalled()
  })

  it('does not call onReady when a page has no 2D canvas context', async () => {
    const onReady = vi.fn()
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn(() => ({ width: 100, height: 100 })),
          render: vi.fn(() => ({ promise: Promise.resolve() })),
          cleanup: vi.fn(),
        }),
      }),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => 'AQ==' }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    const view = render(<DocPdfCanvas pdfUrl="/document.pdf" onReady={onReady} />)

    await waitFor(() => expect(view.getByText('Couldn’t render this PDF')).toBeInTheDocument())
    expect(onReady).not.toHaveBeenCalled()
  })

  it('Retry refetches after a failed load and then paints', async () => {
    const onReady = vi.fn()
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn(() => ({ width: 100, height: 100 })),
          render: vi.fn(() => ({ promise: Promise.resolve() })),
          cleanup: vi.fn(),
        }),
      }),
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValue({ ok: true, text: async () => 'AQ==' })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)

    const view = render(<DocPdfCanvas pdfUrl="/retry.pdf" onReady={onReady} />)
    await waitFor(() => expect(view.getByText('Couldn’t render this PDF')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fireEvent.click(view.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(view.container.querySelector('canvas')).not.toBeNull()
  })

  it('lays out one aspect-correct placeholder per page before anything paints', async () => {
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 3,
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn(() => ({ width: 200, height: 400 })),
          render: vi.fn(() => ({ promise: Promise.resolve() })),
          cleanup: vi.fn(),
        }),
      }),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => 'AQ==' }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)

    const view = render(<DocPdfCanvas pdfUrl="/pages.pdf" sizing="fit" bare />)
    await waitFor(() => expect(view.container.querySelectorAll('[data-pdf-page]')).toHaveLength(3))
    const first = view.container.querySelector<HTMLElement>('[data-pdf-page="1"]')
    expect(first?.style.aspectRatio).toBe('200 / 400')
    expect(first?.style.width).toBe('100%')
  })
})
