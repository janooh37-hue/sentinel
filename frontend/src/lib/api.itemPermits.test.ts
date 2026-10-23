import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type ItemPermitZone } from '@/lib/api'

const fetchMock = vi.fn()
const counts = { none: 2, pending: 601, awaiting_scan: 3, approved: 4, returned: 0, rejected: 0 }

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(counts), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('item permit summary and zone requests', () => {
  it('reads all approval counts from the summary endpoint rather than a capped list', async () => {
    expect(await api.itemPermitsSummary()).toEqual(counts)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/item-permits/summary', expect.objectContaining({ method: 'GET' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each<ItemPermitZone>(['red', 'green', 'work_residence'])('sends zone %s to both summary and list endpoints', async (zone) => {
    await api.itemPermitsSummary(zone)
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/v1/item-permits/summary?zone=${zone}`, expect.objectContaining({ method: 'GET' }))
    await api.listItemPermits({ zone, limit: 4 })
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/v1/item-permits?zone=${zone}&limit=4`, expect.objectContaining({ method: 'GET' }))
  })
})
