import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

import { api } from '@/lib/api'

describe('Workforce Pulse API client', () => {
  it('requests the current workforce access projection', async () => {
    await api.getWorkforceAccess()

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/workforce/access/me',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('requests the workforce dashboard snapshot', async () => {
    await api.getWorkforceSnapshot()

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/workforce/dashboard/snapshot',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('forwards hierarchy coverage filters', async () => {
    await api.getWorkforceCoverage({
      operational_date: '2026-08-24',
      parent_kind: 'duty_unit',
      department: 'Security',
      duty_unit: 'Main Gate',
      limit: 100,
    })

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/workforce/dashboard/coverage?operational_date=2026-08-24&parent_kind=duty_unit&department=Security&duty_unit=Main+Gate&limit=100',
      expect.objectContaining({ method: 'GET' }),
    )
  })
})
