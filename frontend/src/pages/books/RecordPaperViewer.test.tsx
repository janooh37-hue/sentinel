import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PdfDocLease } from '@/lib/pdfDocCache'

import RecordPaperViewer from './RecordPaperViewer'
import type { Paper } from './recordPapers'

const { leasePdfUrlMock } = vi.hoisted(() => ({ leasePdfUrlMock: vi.fn() }))

vi.mock('@/lib/pdfDocCache', () => ({ leasePdfUrl: leasePdfUrlMock }))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))
vi.mock('@/lib/pdf', () => ({
  pdfWorkerUrl: '/worker.js',
  toBase64Url: (u: string) => u,
  base64ToBytes: () => new Uint8Array(),
}))

const observers: Array<{ cb: ResizeObserverCallback; el: Element }> = []

class MockResizeObserver {
  private readonly cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe(el: Element): void {
    observers.push({ cb: this.cb, el })
  }
  unobserve(): void {}
  disconnect(): void {
    for (let i = observers.length - 1; i >= 0; i -= 1) {
      if (observers[i].cb === this.cb) observers.splice(i, 1)
    }
  }
}

function resize(width: number): void {
  act(() => {
    for (const { cb, el } of observers) {
      cb([{ target: el, contentRect: { width } } as unknown as ResizeObserverEntry], {} as ResizeObserver)
    }
  })
}

const scan = (i: number): Paper => ({
  kind: 'scan',
  url: `/api/v1/books/1/attachments/${i}`,
  downloadUrl: `/api/v1/books/1/attachments/${i}`,
  filename: `scan-${i}.png`,
  isPdf: false,
  attachmentIndex: i,
})

describe('RecordPaperViewer', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
  })
  afterEach(() => {
    observers.length = 0
    vi.unstubAllGlobals()
  })

  it('Fit is the container width minus padding, and follows resizes and zoom', async () => {
    render(
      <RecordPaperViewer papers={[scan(0)]} selectedKey="scan-0" onSelectKey={() => undefined} mode="pane" />,
    )
    resize(500)
    const img = screen.getByRole('img', { name: 'scan-0.png' })
    expect(img).toHaveStyle({ width: '468px' })

    resize(700)
    expect(screen.getByRole('img', { name: 'scan-0.png' })).toHaveStyle({ width: '668px' })

    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByRole('img', { name: 'scan-0.png' })).toHaveStyle({ width: '802px' })
  })

  it('fits Books up to actual size, preserves manual zoom on resize, and Fit resumes refitting', async () => {
    render(
      <RecordPaperViewer papers={[scan(0), scan(3)]} selectedKey="scan-0" onSelectKey={() => undefined} mode="pane" initialFit="width" compact />,
    )
    resize(332)
    const img = screen.getByRole('img', { name: 'scan-0.png' })
    Object.defineProperty(img, 'naturalWidth', { value: 600 })
    fireEvent.load(img)
    expect(img).toHaveStyle({ width: '300px' })
    expect(screen.getByText('50%')).toBeInTheDocument()
    resize(932)
    expect(img).toHaveStyle({ width: '600px' })
    expect(screen.getByText('100%')).toBeInTheDocument()
    resize(452)
    expect(img).toHaveStyle({ width: '420px' })
    expect(screen.getByText('70%')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(img).toHaveStyle({ width: '540px' })
    expect(screen.getByText('90%')).toBeInTheDocument()
    resize(332)
    expect(img).toHaveStyle({ width: '540px' })
    await userEvent.click(screen.getByRole('button', { name: 'Fit' }))
    expect(img).toHaveStyle({ width: '300px' })
    resize(392)
    expect(img).toHaveStyle({ width: '360px' })
    expect(screen.getByText('60%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Attachment 2' })).toBeInTheDocument()
  })

  it('shows the selected key in the version dropdown', () => {
    render(
      <RecordPaperViewer
        papers={[scan(0), scan(3)]}
        selectedKey="scan-3"
        onSelectKey={() => undefined}
        mode="pane"
      />,
    )
    resize(400)
    expect(screen.getByRole('img', { name: 'scan-3.png' })).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveTextContent('Attachment 2')
  })

  it('falls back to the first paper when the selected key is gone', () => {
    render(
      <RecordPaperViewer papers={[scan(0)]} selectedKey="signed" onSelectKey={() => undefined} mode="overlay" />,
    )
    resize(400)
    expect(screen.getByRole('img', { name: 'scan-0.png' })).toBeInTheDocument()
  })

  it('a single read-only paper shows neither the version bar nor the page strip', () => {
    render(
      <RecordPaperViewer papers={[scan(0)]} selectedKey="scan-0" onSelectKey={() => undefined} mode="pane" />,
    )
    resize(500)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Page 1' })).not.toBeInTheDocument()
  })

  it('uploaded versions get Upload file, their pages and Add page; the only page has no delete', async () => {
    const onUpload = vi.fn()
    const onAddPages = vi.fn()
    render(
      <RecordPaperViewer
        papers={[scan(0)]}
        selectedKey="scan-0"
        onSelectKey={() => undefined}
        mode="pane"
        onUpload={onUpload}
        onAddPages={onAddPages}
        onDeletePage={() => undefined}
      />,
    )
    resize(500)
    await userEvent.click(screen.getByRole('button', { name: 'Upload file' }))
    expect(onUpload).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'Page 1' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete page 1' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add page' }))
    expect(onAddPages).toHaveBeenCalledWith(scan(0))
  })

  it('the generated original never offers Add page', () => {
    const original: Paper = { ...scan(0), kind: 'generated', attachmentIndex: undefined }
    render(
      <RecordPaperViewer papers={[original]} selectedKey="generated" onSelectKey={() => undefined} mode="pane" onAddPages={() => undefined} onUpload={() => undefined} />,
    )
    resize(500)
    expect(screen.queryByRole('button', { name: 'Add page' })).not.toBeInTheDocument()
  })

  it('the overlay toolbar carries the paper switcher', async () => {
    const onSelectKey = vi.fn()
    render(
      <RecordPaperViewer papers={[scan(0), scan(3)]} selectedKey="scan-0" onSelectKey={onSelectKey} mode="overlay" />,
    )
    resize(500)
    await userEvent.click(screen.getByRole('button', { name: 'Attachment 2' }))
    expect(onSelectKey).toHaveBeenCalledWith('scan-3')
  })

  it('collapses Replace / Delete into a ⋯ menu on a narrow viewer', () => {
    const { unmount } = render(
      <RecordPaperViewer
        papers={[scan(0)]}
        selectedKey="scan-0"
        onSelectKey={() => undefined}
        mode="pane"
        onDeletePaper={() => undefined}
        onReplacePaper={() => undefined}
      />,
    )
    resize(600)
    expect(screen.getByRole('button', { name: 'Delete version' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    unmount()

    render(
      <RecordPaperViewer
        papers={[scan(0)]}
        selectedKey="scan-0"
        onSelectKey={() => undefined}
        mode="pane"
        onDeletePaper={() => undefined}
        onReplacePaper={() => undefined}
      />,
    )
    resize(380)
    expect(screen.queryByRole('button', { name: 'Delete version' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
  })

  it('releases a lease that resolves after the viewer was torn down', async () => {
    // `Promise.withResolvers` is the house style, but tsconfig pins lib ES2023, hence the executor.
    let resolve: (lease: PdfDocLease) => void = () => undefined
    const promise = new Promise<PdfDocLease>((res) => {
      resolve = res
    })
    leasePdfUrlMock.mockReturnValueOnce(promise)
    const release = vi.fn()
    const pdf: Paper = { ...scan(0), url: '/api/v1/books/1/attachments/0?v=aa', filename: 'scan-0.pdf', isPdf: true }
    const { unmount } = render(
      <RecordPaperViewer papers={[pdf]} selectedKey="scan-0" onSelectKey={() => undefined} mode="pane" />,
    )
    resize(500)
    await vi.waitFor(() => expect(leasePdfUrlMock).toHaveBeenCalledTimes(1))

    unmount()
    // The cache resolved the lease just as cleanup ran (it does not see the abort in time).
    resolve({ doc: {} as PdfDocLease['doc'], release })
    await promise
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
  })
})
