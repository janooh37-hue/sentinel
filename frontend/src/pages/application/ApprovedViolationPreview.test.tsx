import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDocumentMock } = vi.hoisted(() => ({ getDocumentMock: vi.fn() }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: getDocumentMock,
}))

import { ApprovedViolationPreview } from './ApprovedViolationPreview'

describe('ApprovedViolationPreview', () => {
  beforeEach(() => {
    getDocumentMock.mockReset()
    vi.restoreAllMocks()
  })

  it('previews an image locally and revokes its object URL', () => {
    const createObjectURL = vi.fn(() => 'blob:approved')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const file = new File(['png'], 'approved.png', { type: 'image/png' })

    const view = render(<ApprovedViolationPreview file={file} />)

    expect(screen.getByRole('img', { name: 'approved.png' })).toHaveAttribute(
      'src',
      'blob:approved',
    )
    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:approved')
  })

  it('renders only the first PDF page to a DPR-scaled canvas', async () => {
    const renderPage = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))
    const getPage = vi.fn().mockResolvedValue({
      getViewport: vi.fn(() => ({ width: 200, height: 300 })),
      render: renderPage,
    })
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({ getPage, destroy: vi.fn() }),
      destroy: vi.fn(),
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D,
    )
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 })
    const file = new File(['pdf'], 'approved.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
    })

    const view = render(<ApprovedViolationPreview file={file} />)

    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1))
    expect(getPage).toHaveBeenCalledWith(1)
    const canvas = view.container.querySelector('canvas')
    expect(canvas).toHaveAttribute('width', '400')
    expect(canvas).toHaveAttribute('height', '600')
    expect(renderPage).toHaveBeenCalledWith(
      expect.objectContaining({ transform: [2, 0, 0, 2, 0, 0] }),
    )
  })

  it('shows a useful error when the local PDF cannot render', async () => {
    getDocumentMock.mockReturnValue({
      promise: Promise.reject(new Error('bad pdf')),
      destroy: vi.fn(),
    })
    const file = new File(['pdf'], 'broken.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(new Uint8Array([1]).buffer),
    })

    render(<ApprovedViolationPreview file={file} />)

    expect(await screen.findByText("Couldn't preview this file.")).toBeVisible()
  })
})
