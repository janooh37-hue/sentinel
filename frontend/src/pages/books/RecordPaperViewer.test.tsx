import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RecordPaperViewer from './RecordPaperViewer'
import type { Paper } from './recordPapers'

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

  it('selects by key and reports key picks', async () => {
    const onSelectKey = vi.fn()
    render(
      <RecordPaperViewer
        papers={[scan(0), scan(3)]}
        selectedKey="scan-3"
        onSelectKey={onSelectKey}
        mode="pane"
      />,
    )
    resize(400)
    expect(screen.getByRole('img', { name: 'scan-3.png' })).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { pressed: false })[0])
    expect(onSelectKey).toHaveBeenCalledWith('scan-0')
  })

  it('falls back to the first paper when the selected key is gone', () => {
    render(
      <RecordPaperViewer papers={[scan(0)]} selectedKey="signed" onSelectKey={() => undefined} mode="overlay" />,
    )
    resize(400)
    expect(screen.getByRole('img', { name: 'scan-0.png' })).toBeInTheDocument()
  })
})
