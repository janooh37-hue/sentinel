import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
const fetchMock = vi.fn()
beforeEach(() => { fetchMock.mockClear(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.unstubAllGlobals() })
import { api } from '@/lib/api'

describe('api.getWordTemplateTable', () => {
  it('GETs /books/word-templates/{name}/table and returns has_table+columns', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ has_table: true, columns: ['المادة','العدد'] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const r = await api.getWordTemplateTable('الصيانة.docx')
    expect(fetchMock).toHaveBeenCalledOnce()
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('/books/word-templates/')
    expect(url).toContain('/table')
    expect(r).toEqual({ has_table: true, columns: ['المادة','العدد'] })
  })
})
describe('api.deleteWordTemplate', () => {
  it('DELETEs /books/word-templates/{name}', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await api.deleteWordTemplate('الصيانة.docx')
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/books/word-templates/')
    expect(String(opts.method).toUpperCase()).toBe('DELETE')
  })
})
