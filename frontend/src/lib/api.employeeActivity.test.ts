import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

import { api } from '@/lib/api'

describe('api.listEmployeeActivity', () => {
  it('forwards employee, kind, limit, and offset filters', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], total: 0, limit: 25, offset: 25 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await api.listEmployeeActivity({
      employee_id: 'G 100',
      kind: 'leave',
      limit: 25,
      offset: 25,
    })

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('/employees/activity?')
    expect(url).toContain('employee_id=G+100')
    expect(url).toContain('kind=leave')
    expect(url).toContain('limit=25')
    expect(url).toContain('offset=25')
    expect(result.total).toBe(0)
  })
})
