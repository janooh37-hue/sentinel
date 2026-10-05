import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { purgePdfCaches } from '@/lib/pdfCachePurge'

const { leasePdfUrlMock } = vi.hoisted(() => ({ leasePdfUrlMock: vi.fn() }))

vi.mock('@/lib/pdfDocCache', () => ({ leasePdfUrl: leasePdfUrlMock }))

import { cachedThumb, loadThumb } from './recordPaperThumbs'

interface Gate {
  url: string
  release: Mock
  open: () => void
}

describe('recordPaperThumbs', () => {
  let gates: Gate[]
  let running: number
  let peak: number

  beforeEach(() => {
    purgePdfCaches()
    gates = []
    running = 0
    peak = 0
    // Every lease stays pending until its gate opens; the doc has no canvas
    // support in jsdom, so a build resolves with `src: null` and the page count.
    leasePdfUrlMock.mockReset()
    leasePdfUrlMock.mockImplementation((url: string) => {
      running += 1
      peak = Math.max(peak, running)
      // `Promise.withResolvers` is the house style, but tsconfig pins lib ES2023, hence the executor.
      let resolve: () => void = () => undefined
      const promise = new Promise<void>((res) => {
        resolve = res
      })
      const release = vi.fn(() => {
        running -= 1
      })
      gates.push({ url, release, open: resolve })
      return promise.then(() => ({
        doc: {
          numPages: 3,
          getPage: async () => ({
            getViewport: () => ({ width: 100, height: 140 }),
            render: () => ({ promise: Promise.resolve() }),
          }),
        },
        release,
      }))
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })

  it('builds thumbnails one at a time, in request order', async () => {
    const signal = new AbortController().signal
    const all = Promise.all(['/a', '/b', '/c'].map((url) => loadThumb(url, signal)))

    await vi.waitFor(() => expect(gates).toHaveLength(1))
    gates[0].open()
    await vi.waitFor(() => expect(gates).toHaveLength(2))
    gates[1].open()
    await vi.waitFor(() => expect(gates).toHaveLength(3))
    gates[2].open()
    await all

    expect(gates.map((g) => g.url)).toEqual(['/a', '/b', '/c'])
    expect(peak).toBe(1)
    expect(cachedThumb('/b')).toEqual({ src: null, pages: 3 })
  })

  it('skips a request aborted while queued without leasing the document', async () => {
    const live = new AbortController()
    const dead = new AbortController()
    const first = loadThumb('/a', live.signal)
    const skipped = loadThumb('/b', dead.signal)
    skipped.catch(() => undefined)
    const last = loadThumb('/c', live.signal)

    await vi.waitFor(() => expect(gates).toHaveLength(1))
    dead.abort()
    gates[0].open()
    await first
    await vi.waitFor(() => expect(gates).toHaveLength(2))
    gates[1].open()
    await last

    await expect(skipped).rejects.toMatchObject({ name: 'AbortError' })
    expect(gates.map((g) => g.url)).toEqual(['/a', '/c'])
  })

  it('does not store a thumbnail whose build was in flight when the caches were purged', async () => {
    const pending = loadThumb('/a', new AbortController().signal)
    await vi.waitFor(() => expect(gates).toHaveLength(1))
    purgePdfCaches()
    gates[0].open()
    await pending
    expect(cachedThumb('/a')).toBeUndefined()
  })

  it('purgePdfCaches empties the thumbnail cache', async () => {
    const pending = loadThumb('/a', new AbortController().signal)
    await vi.waitFor(() => expect(gates).toHaveLength(1))
    gates[0].open()
    await pending
    expect(cachedThumb('/a')).toBeDefined()
    purgePdfCaches()
    expect(cachedThumb('/a')).toBeUndefined()
  })
})
