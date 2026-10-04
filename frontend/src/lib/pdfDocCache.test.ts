import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const { getDocumentMock } = vi.hoisted(() => ({ getDocumentMock: vi.fn() }))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: getDocumentMock,
}))

import { clearPdfDocCache, leasePdfUrl, PDF_DOC_CACHE_SIZE } from './pdfDocCache'

interface FakeDoc {
  url: string
  destroy: Mock
}

describe('pdfDocCache', () => {
  let docs: FakeDoc[]
  let fetchMock: Mock

  beforeEach(() => {
    docs = []
    getDocumentMock.mockReset()
    getDocumentMock.mockImplementation(() => {
      const doc: FakeDoc = { url: `doc-${docs.length}`, destroy: vi.fn().mockResolvedValue(undefined) }
      docs.push(doc)
      return { promise: Promise.resolve(doc) }
    })
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => 'AQ==' })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    clearPdfDocCache()
    vi.unstubAllGlobals()
  })

  it('returns the same proxy for the same URL without refetching', async () => {
    const a = await leasePdfUrl('/a.pdf')
    const b = await leasePdfUrl('/a.pdf')
    expect(b.doc).toBe(a.doc)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getDocumentMock).toHaveBeenCalledTimes(1)
    a.release()
    b.release()
    const again = await leasePdfUrl('/a.pdf')
    expect(again.doc).toBe(a.doc)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    again.release()
  })

  it('shares one load between concurrent leases', async () => {
    const [a, b] = await Promise.all([leasePdfUrl('/a.pdf'), leasePdfUrl('/a.pdf')])
    expect(a.doc).toBe(b.doc)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('destroys the least recently used idle document on eviction, never a leased one', async () => {
    expect(PDF_DOC_CACHE_SIZE).toBe(3)
    const first = await leasePdfUrl('/1.pdf') // stays leased
    const second = await leasePdfUrl('/2.pdf')
    second.release()
    const third = await leasePdfUrl('/3.pdf')
    third.release()
    expect(docs.every((d) => d.destroy.mock.calls.length === 0)).toBe(true)

    const fourth = await leasePdfUrl('/4.pdf')
    fourth.release()

    // /1 is the oldest but still leased: /2 (oldest idle) goes.
    const byUrl = new Map(docs.map((d, i) => [`/${i + 1}.pdf`, d]))
    expect(byUrl.get('/1.pdf')?.destroy).not.toHaveBeenCalled()
    expect(byUrl.get('/2.pdf')?.destroy).toHaveBeenCalledTimes(1)
    expect(byUrl.get('/3.pdf')?.destroy).not.toHaveBeenCalled()
    expect(byUrl.get('/4.pdf')?.destroy).not.toHaveBeenCalled()

    // Releasing the old lease makes it evictable on the next trim.
    first.release()
    const fifth = await leasePdfUrl('/5.pdf')
    fifth.release()
    expect(byUrl.get('/1.pdf')?.destroy).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed load, so a retry refetches', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    await expect(leasePdfUrl('/bad.pdf')).rejects.toThrow('HTTP 500')
    const lease = await leasePdfUrl('/bad.pdf')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    lease.release()
  })

  it('aborts an in-flight lease and releases it', async () => {
    const controller = new AbortController()
    const pending = leasePdfUrl('/slow.pdf', controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
