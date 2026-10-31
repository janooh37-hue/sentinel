import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ReactI18next from 'react-i18next'

import type { StoreDeliveryScan, StoreScanLine } from '@/lib/api'

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument }))
vi.mock('@/lib/pdf', () => ({ pdfWorkerUrl: '/local-pdf-worker.mjs' }))
vi.mock('react-i18next', async (importOriginal) => {
  const original = await importOriginal<typeof ReactI18next>()
  return { ...original, useTranslation: () => ({ t: (key: string) => key }) }
})

import { ScanNotePreview } from './ScanNotePreview'

const line: StoreScanLine = {
  raw_text: 'Coffee 8', item_id: 1, match_score: 95, quantity: 8,
  confidence: 95, page: 0, bbox: { x: 10, y: 50, w: 480, h: 20 },
}
const scan: StoreDeliveryScan = {
  pages: [{ width: 1000, height: 800 }, { width: 1000, height: 800 }],
  lines: [line, { ...line, raw_text: 'Water 8' }],
  ocr_available: true,
}

class LocalImage {
  static instances: LocalImage[] = []
  naturalWidth = 500
  naturalHeight = 400
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  src = ''
  removeAttribute = vi.fn()

  constructor() {
    LocalImage.instances.push(this)
  }
}

function Rows({ file, result = scan }: { file: File; result?: StoreDeliveryScan }): React.JSX.Element {
  return <ScanNotePreview file={file} scan={result} render={(crop) => <>{result.lines.map((row, index) => <div key={index}>{crop(row)}</div>)}</>} />
}

function pdfFile(): File {
  const file = new File(['local PDF bytes'], 'note.pdf', { type: 'application/pdf' })
  Object.defineProperty(file, 'arrayBuffer', { value: vi.fn().mockResolvedValue(new ArrayBuffer(8)) })
  return file
}

function pdfFixture() {
  const renderPage = vi.fn<(options: { canvas: HTMLCanvasElement }) => { promise: Promise<void>; cancel: () => void }>(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))
  const cleanup = vi.fn()
  const getPage = vi.fn().mockImplementation(() => Promise.resolve({
    getViewport: ({ scale }: { scale: number }) => ({ width: 500 * scale, height: 400 * scale }),
    render: renderPage,
    cleanup,
  }))
  const destroy = vi.fn().mockResolvedValue(undefined)
  getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 2, getPage }), destroy })
  return { renderPage, cleanup, getPage, destroy }
}

describe('ScanNotePreview', () => {
  const drawImage = vi.fn()
  const createObjectURL = vi.fn()
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    getDocument.mockReset()
    drawImage.mockReset()
    createObjectURL.mockReset().mockReturnValue('blob:local-note')
    revokeObjectURL.mockReset()
    LocalImage.instances = []
    vi.stubGlobal('Image', LocalImage)
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = revokeObjectURL
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('decodes an image once and maps OCR-upscaled coordinates without RTL mirroring', async () => {
    const file = new File(['image bytes'], 'note.png', { type: 'image/png' })
    const view = render(<div dir="rtl"><Rows file={file} /></div>)
    await act(async () => { LocalImage.instances[0].onload?.() })

    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(2))
    expect(createObjectURL).toHaveBeenCalledExactlyOnceWith(file)
    expect(LocalImage.instances).toHaveLength(1)
    expect(drawImage).toHaveBeenCalledWith(LocalImage.instances[0], 0, 21.5, 250, 17, 0, 0, 706, 48)
    for (const canvas of screen.getAllByRole('img')) {
      expect(canvas).toHaveAttribute('dir', 'ltr')
      expect(canvas).toHaveAccessibleName('assets.store.scan.cropAlt')
      expect(canvas.parentElement).toHaveAttribute('dir', 'ltr')
      expect(canvas.closest('button')).toHaveAttribute('aria-busy', 'false')
    }

    const canvases = view.container.querySelectorAll('canvas')
    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:local-note')
    expect(LocalImage.instances[0].onload).toBeNull()
    for (const canvas of canvases) expect(canvas.width).toBe(0)
    expect(getDocument).not.toHaveBeenCalled()
  })

  it('shares one PDF parse and one raster per page, including later OCR pages', async () => {
    const pdf = pdfFixture()
    const result: StoreDeliveryScan = { ...scan, lines: [...scan.lines, { ...line, page: 1 }] }
    const view = render(<Rows file={pdfFile()} result={result} />)

    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(3))
    expect(getDocument).toHaveBeenCalledTimes(1)
    expect(getDocument.mock.calls[0][0].data).toBeInstanceOf(Uint8Array)
    expect(pdf.getPage.mock.calls).toEqual([[1], [2]])
    expect(pdf.renderPage).toHaveBeenCalledTimes(2)
    expect(pdf.cleanup).toHaveBeenCalledTimes(2)
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(drawImage.mock.calls[0].slice(1)).toEqual([0, 43, 500, 34, 0, 0, 706, 48])
    const pageCanvases = pdf.renderPage.mock.calls.map(([options]) => options.canvas)

    view.unmount()
    expect(pdf.destroy).toHaveBeenCalledTimes(1)
    for (const canvas of pageCanvases) expect(canvas.width).toBe(0)
  })

  it('clips boxes at page bounds before mapping to the local image', async () => {
    const result: StoreDeliveryScan = { ...scan, lines: [{ ...line, bbox: { x: -10, y: 790, w: 100, h: 40 } }] }
    render(<Rows file={new File(['image'], 'note.jpg', { type: 'image/jpeg' })} result={result} />)
    await act(async () => { LocalImage.instances[0].onload?.() })

    await waitFor(() => expect(drawImage).toHaveBeenCalledOnce())
    expect(drawImage).toHaveBeenCalledWith(LocalImage.instances[0], 0, 388, 55, 12, 0, 0, 220, 48)
  })

  it.each(['ltr', 'rtl'])('keeps wide %s phone crops keyboard-scrollable and opens an accessible enlargement', async (dir) => {
    const user = userEvent.setup()
    const result: StoreDeliveryScan = { ...scan, lines: [{ ...line, bbox: { x: 10, y: 50, w: 900, h: 20 } }] }
    render(<div dir={dir}><Rows file={new File(['image'], 'note.jpg', { type: 'image/jpeg' })} result={result} /></div>)
    await act(async () => { LocalImage.instances[0].onload?.() })
    const button = screen.getByRole('button', { name: 'assets.store.scan.cropEnlarge 1' })
    await waitFor(() => expect(button).toBeEnabled())
    const preview = screen.getByRole('img') as HTMLCanvasElement
    expect(preview.height).toBeGreaterThanOrEqual(48)
    expect(preview.width).toBeGreaterThan(322)
    expect(preview).toHaveStyle({ height: '48px' })
    expect(preview).toHaveClass('max-w-none')
    expect(preview.parentElement).not.toHaveClass('overflow-x-auto')
    expect(button).toHaveClass('min-h-11', 'overflow-x-auto')
    expect(button).toHaveAttribute('dir', 'ltr')
    expect(button.tabIndex).toBe(0)
    expect(button.querySelector('[tabindex]')).toBeNull()

    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'assets.store.scan.cropEnlarge 1' })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    const zoom = dialog.querySelector('canvas')!
    expect(zoom).toHaveAccessibleName('assets.store.scan.cropAlt')
    expect(zoom).toHaveStyle({ height: '96px' })
    expect(zoom.width).toBe(preview.width * 2)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(button).toHaveFocus()
  })

  it('offers an accessible fallback when the local file cannot be decoded', async () => {
    render(<Rows file={new File(['broken'], 'note.png', { type: 'image/png' })} />)
    await act(async () => { LocalImage.instances[0].onerror?.() })

    await waitFor(() => expect(screen.getAllByText('assets.store.scan.cropUnavailable')).toHaveLength(2))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(drawImage).not.toHaveBeenCalled()
  })

  it('does not hide valid crops when a later page is unavailable', async () => {
    const pdf = pdfFixture()
    pdf.getPage.mockImplementation((page: number) => page === 2
      ? Promise.reject(new Error('Cannot raster page'))
      : Promise.resolve({
        getViewport: ({ scale }: { scale: number }) => ({ width: 500 * scale, height: 400 * scale }),
        render: pdf.renderPage,
        cleanup: pdf.cleanup,
      }))
    const result: StoreDeliveryScan = { ...scan, lines: [line, { ...line, page: 1 }] }
    render(<Rows file={pdfFile()} result={result} />)

    await waitFor(() => expect(screen.getByText('assets.store.scan.cropUnavailable')).toBeInTheDocument())
    expect(drawImage).toHaveBeenCalledOnce()
    expect(screen.getByRole('img')).toHaveAccessibleName('assets.store.scan.cropAlt')
  })

  it('cancels an in-flight PDF render and destroys the local document on unmount', async () => {
    const pdf = pdfFixture()
    const cancel = vi.fn()
    let rejectRender: (reason: Error) => void = () => undefined
    const pending = new Promise<void>((_resolve, reject) => { rejectRender = reject })
    pdf.renderPage.mockReturnValueOnce({ promise: pending, cancel })
    const view = render(<Rows file={pdfFile()} />)
    await waitFor(() => expect(pdf.renderPage).toHaveBeenCalledOnce())

    view.unmount()
    expect(cancel).toHaveBeenCalledOnce()
    expect(pdf.destroy).toHaveBeenCalledOnce()
    await act(async () => { rejectRender(new Error('RenderingCancelledException')) })
    expect(drawImage).not.toHaveBeenCalled()
  })

  it('does not start a PDF worker if file reading finishes after unmount', async () => {
    const file = pdfFile()
    let resolveFile: (buffer: ArrayBuffer) => void = () => undefined
    vi.mocked(file.arrayBuffer).mockReturnValueOnce(new Promise<ArrayBuffer>((resolve) => { resolveFile = resolve }))
    const view = render(<Rows file={file} />)
    view.unmount()

    await act(async () => { resolveFile(new ArrayBuffer(8)) })
    expect(getDocument).not.toHaveBeenCalled()
  })
})
