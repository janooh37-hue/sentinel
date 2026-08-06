import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDocumentMock } = vi.hoisted(() => ({
  getDocumentMock: vi.fn(),
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: getDocumentMock,
}))

import DocPdfCanvas from './DocPdfCanvas'

describe('DocPdfCanvas readiness', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    getDocumentMock.mockReset()
  })

  it('calls onReady once after every page finishes painting', async () => {
    const onReady = vi.fn()
    const renderPage = vi.fn(() => ({ promise: Promise.resolve() }))
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn(() => ({ width: 100, height: 100 })),
          render: renderPage,
        }),
      }),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => 'AQ==' }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)

    const view = render(<DocPdfCanvas pdfUrl="/document.pdf" onReady={onReady} />)

    await waitFor(() => expect(view.container.querySelector('canvas')).not.toBeNull())
    expect(renderPage).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('does not call onReady when the PDF request fails', async () => {
    const onReady = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const view = render(<DocPdfCanvas pdfUrl="/document.pdf" onReady={onReady} />)

    await waitFor(() => expect(view.getByText("Couldn't render this file")).toBeInTheDocument())
    expect(onReady).not.toHaveBeenCalled()
  })
})
