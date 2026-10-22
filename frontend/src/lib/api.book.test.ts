import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 2 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('api.getBook', () => {
  it('keeps the default read request free of optional query parameters', async () => {
    await api.getBook(2)

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/books/2', expect.objectContaining({ method: 'GET' }))
  })

  it('preserves the selected version without overriding the default read behavior', async () => {
    await api.getBook(2, 7)

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/books/2?version_id=7', expect.objectContaining({ method: 'GET' }))
  })

  it.each([false, true])('sends explicit markRead=%s alongside the selected version', async (markRead) => {
    await api.getBook(2, 7, { markRead })

    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/books/2?version_id=7&mark_read=${markRead}`, expect.objectContaining({ method: 'GET' }))
  })

  it('sends mark_read=false without requiring a selected version', async () => {
    await api.getBook(2, undefined, { markRead: false })

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/books/2?mark_read=false', expect.objectContaining({ method: 'GET' }))
  })
})
