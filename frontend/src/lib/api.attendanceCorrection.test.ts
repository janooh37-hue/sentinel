import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

import { api } from '@/lib/api'

function jsonResponse(body: unknown, etag?: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...(etag ? { ETag: etag } : {}),
    },
  })
}

describe('Attendance correction API client', () => {
  it('forwards attendance exception filters', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [], next_cursor: null }))

    await api.listAttendanceExceptions({
      operational_date: '2026-08-25',
      presence: 'absent',
      exception: 'missing_checkout',
      limit: 50,
      cursor: 'page-2',
    })

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/workforce/attendance/exceptions?operational_date=2026-08-25&presence=absent&exception=missing_checkout&limit=50&cursor=page-2',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('returns the case body and ETag from a versioned response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 42 }, '"case-v1"'))

    const loaded = await api.getAttendanceCase(42)

    expect(loaded).toEqual({ data: { id: 42 }, etag: '"case-v1"' })
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/workforce/attendance/cases/42',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('fails when a versioned response omits its ETag', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 42 }))

    await expect(api.getAttendanceCase(42)).rejects.toMatchObject({
      status: 500,
      code: 'MISSING_ETAG',
    })
  })

  it('creates an adjustment with the supplied case ETag', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 8, case_id: 42 }, '"case-v2"'))

    await api.createAttendanceAdjustment(42, '"case-v1"', {
      replacement_presence_state: 'completed',
      reason: 'Supervisor register',
    })

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/workforce/attendance/cases/42/adjustments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'If-Match': '"case-v1"',
        }),
        body: JSON.stringify({
          replacement_presence_state: 'completed',
          reason: 'Supervisor register',
        }),
      }),
    )
  })

  it('revokes an adjustment with the supplied case ETag', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 8, revoked_at: '2026-08-25T01:00:00+04:00' }, '"case-v3"'))

    await api.revokeAttendanceAdjustment(42, 8, '"case-v2"', { reason: 'Entry duplicated' })

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/workforce/attendance/cases/42/adjustments/8/revoke',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'If-Match': '"case-v2"',
        }),
        body: JSON.stringify({ reason: 'Entry duplicated' }),
      }),
    )
  })

  it('rejects a write without a current case ETag', async () => {
    await expect(
      api.createAttendanceAdjustment(42, '', {
        replacement_presence_state: 'completed',
        reason: 'Supervisor register',
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'MISSING_ETAG',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
