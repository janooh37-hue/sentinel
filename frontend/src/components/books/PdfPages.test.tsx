import { render, waitFor } from '@testing-library/react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { installMockIntersectionObserver, setNearPages as setNear } from '@/test/mockIntersectionObserver'
import { PdfPages } from './PdfPages'

interface StubDoc {
  doc: PDFDocumentProxy
  cleanup: Mock[]
  render: Mock[]
}

function makeDoc(numPages: number): StubDoc {
  const cleanup = Array.from({ length: numPages }, () => vi.fn())
  const renders = Array.from({ length: numPages }, () => vi.fn(() => ({ promise: Promise.resolve() })))
  const doc = {
    numPages,
    getPage: vi.fn((n: number) =>
      Promise.resolve({
        getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }),
        render: renders[n - 1],
        cleanup: cleanup[n - 1],
      }),
    ),
  } as unknown as PDFDocumentProxy
  return { doc, cleanup, render: renders }
}

const canvasCount = (root: HTMLElement): number => root.querySelectorAll('canvas').length
const boxOf = (root: HTMLElement, n: number): HTMLElement => {
  const box = root.querySelector<HTMLElement>(`[data-pdf-page="${n}"]`)
  if (!box) throw new Error(`no page box ${n}`)
  return box
}

describe('PdfPages', () => {
  beforeEach(() => {
    installMockIntersectionObserver()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('without eager, a long document only paints the pages near the viewport', async () => {
    const { doc, render: renders } = makeDoc(13)
    const painted = vi.fn()
    const view = render(<PdfPages doc={doc} sizing={{ kind: 'fit' }} onPainted={painted} />)
    await waitFor(() => expect(view.container.querySelectorAll('[data-pdf-page]')).toHaveLength(13))

    await setNear([1, 2])

    await waitFor(() => expect(painted).toHaveBeenCalled())
    expect(canvasCount(view.container)).toBe(2)
    expect(renders[2]).not.toHaveBeenCalled()
  })

  it('lets a test mark pages near as soon as the page boxes commit, before their effects run', async () => {
    const { doc } = makeDoc(13)
    const view = render(<PdfPages doc={doc} sizing={{ kind: 'fit' }} />)
    // Resume in the microtask right after the commit that renders the boxes: the passive
    // effect that builds the near observer has not run yet (on a loaded runner, waitFor can
    // hand control back at this same point). ES2023 lib predates Promise.withResolvers.
    await new Promise<void>((resolve) => {
      const mo = new MutationObserver(() => {
        if (view.container.querySelectorAll('[data-pdf-page]').length !== 13) return
        mo.disconnect()
        resolve()
      })
      mo.observe(view.container, { childList: true, subtree: true })
    })

    await setNear([1])

    await waitFor(() => expect(canvasCount(view.container)).toBe(1))
  })

  it('with eager, onPainted waits until every page of a long document has painted', async () => {
    const { doc } = makeDoc(13)
    const counts: number[] = []
    let root: HTMLElement | null = null
    const painted = vi.fn(() => {
      counts.push(root ? canvasCount(root) : -1)
    })
    const view = render(<PdfPages doc={doc} sizing={{ kind: 'fit' }} eager onPainted={painted} />)
    root = view.container
    await waitFor(() => expect(view.container.querySelectorAll('[data-pdf-page]')).toHaveLength(13))

    await setNear([1])

    await waitFor(() => expect(painted).toHaveBeenCalled())
    expect(counts.every((c) => c === 13)).toBe(true)
    for (let n = 1; n <= 13; n += 1) expect(boxOf(view.container, n).querySelector('canvas')).not.toBeNull()
  })

  it('fires onPainted again when eager is switched on for pages that are already painted', async () => {
    const { doc } = makeDoc(13)
    const counts: number[] = []
    let root: HTMLElement | null = null
    const painted = vi.fn(() => {
      counts.push(root ? canvasCount(root) : -1)
    })
    const view = render(<PdfPages doc={doc} sizing={{ kind: 'fit' }} onPainted={painted} />)
    root = view.container
    await waitFor(() => expect(view.container.querySelectorAll('[data-pdf-page]')).toHaveLength(13))
    await setNear([1])
    // Page 1 may report twice (the first paint before the observer reports, then as the near
    // page), depending on whether that first paint finished before setNear: one canvas either way.
    await waitFor(() => expect(painted).toHaveBeenCalled())
    expect(canvasCount(view.container)).toBe(1)

    view.rerender(<PdfPages doc={doc} sizing={{ kind: 'fit' }} eager onPainted={painted} />)
    await waitFor(() => expect(counts.at(-1)).toBe(13))

    // A second print: eager off, then on again — everything is painted, the signal still fires.
    const before = counts.length
    view.rerender(<PdfPages doc={doc} sizing={{ kind: 'fit' }} onPainted={painted} />)
    view.rerender(<PdfPages doc={doc} sizing={{ kind: 'fit' }} eager onPainted={painted} />)
    await waitFor(() => expect(counts.length).toBeGreaterThan(before))
    expect(counts.at(-1)).toBe(13)
  })

  it('releases pages that leave the near set (with a margin) and repaints them on return', async () => {
    const { doc, cleanup, render: renders } = makeDoc(20)
    const view = render(<PdfPages doc={doc} sizing={{ kind: 'fit' }} />)
    await waitFor(() => expect(view.container.querySelectorAll('[data-pdf-page]')).toHaveLength(20))

    await setNear([1, 2])
    await waitFor(() => expect(canvasCount(view.container)).toBe(2))
    const first = boxOf(view.container, 1).querySelector('canvas')
    expect(first).not.toBeNull()
    expect(first?.width).toBeGreaterThan(0)

    await setNear([10, 11])
    await waitFor(() => expect(canvasCount(view.container)).toBe(2))
    expect(boxOf(view.container, 1).querySelector('canvas')).toBeNull()
    expect(boxOf(view.container, 10).querySelector('canvas')).not.toBeNull()
    expect(first?.width).toBe(0)
    expect(first?.height).toBe(0)
    expect(cleanup[0]).toHaveBeenCalled()
    expect(cleanup[1]).toHaveBeenCalled()

    // Pages inside the margin of the new near set are untouched.
    await setNear([4])
    await waitFor(() => expect(boxOf(view.container, 4).querySelector('canvas')).not.toBeNull())
    expect(boxOf(view.container, 10).querySelector('canvas')).toBeNull()

    const rendersBefore = renders[0].mock.calls.length
    await setNear([1])
    await waitFor(() => expect(boxOf(view.container, 1).querySelector('canvas')).not.toBeNull())
    expect(renders[0].mock.calls.length).toBe(rendersBefore + 1)
  })

  it('keeps pages within two pages of the near set', async () => {
    const { doc, cleanup } = makeDoc(20)
    const view = render(<PdfPages doc={doc} sizing={{ kind: 'fit' }} />)
    await waitFor(() => expect(view.container.querySelectorAll('[data-pdf-page]')).toHaveLength(20))

    await setNear([5])
    await waitFor(() => expect(canvasCount(view.container)).toBe(1))
    await setNear([7])
    await waitFor(() => expect(boxOf(view.container, 7).querySelector('canvas')).not.toBeNull())
    expect(boxOf(view.container, 5).querySelector('canvas')).not.toBeNull()
    expect(cleanup[4]).not.toHaveBeenCalled()

    await setNear([8])
    await waitFor(() => expect(boxOf(view.container, 8).querySelector('canvas')).not.toBeNull())
    expect(boxOf(view.container, 5).querySelector('canvas')).toBeNull()
    expect(cleanup[4]).toHaveBeenCalled()
  })

  it('never releases a page while eager', async () => {
    const { doc, cleanup } = makeDoc(20)
    const painted = vi.fn()
    const view = render(<PdfPages doc={doc} sizing={{ kind: 'fit' }} eager onPainted={painted} />)
    await waitFor(() => expect(view.container.querySelectorAll('[data-pdf-page]')).toHaveLength(20))
    await setNear([1])
    await waitFor(() => expect(painted).toHaveBeenCalled())

    await setNear([20])

    await waitFor(() => expect(painted.mock.calls.length).toBeGreaterThanOrEqual(1))
    expect(canvasCount(view.container)).toBe(20)
    for (const fn of cleanup) expect(fn).not.toHaveBeenCalled()
  })

  it('frees every bitmap and page on unmount', async () => {
    const { doc, cleanup } = makeDoc(3)
    const view = render(<PdfPages doc={doc} sizing={{ kind: 'fit' }} />)
    await waitFor(() => expect(view.container.querySelectorAll('[data-pdf-page]')).toHaveLength(3))
    await setNear([1, 2, 3])
    await waitFor(() => expect(canvasCount(view.container)).toBe(3))
    const canvases = Array.from(view.container.querySelectorAll('canvas'))

    view.unmount()

    for (const canvas of canvases) expect(canvas.width).toBe(0)
    for (const fn of cleanup) expect(fn).toHaveBeenCalled()
  })
})
