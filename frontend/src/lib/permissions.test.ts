import { describe, expect, it, vi } from 'vitest'
import { api } from './api'

describe('api.setUserPermissionsBulk', () => {
  it('PUTs the items array to the bulk endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      user_id: 7, role: 'manager', is_admin: false,
      effective: [], role_defaults: [], overrides: {},
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await api.setUserPermissionsBulk(7, [
      { capability: 'books.delete', effect: 'deny' },
      { capability: 'permits.revoke', effect: null },
    ])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/auth/users/7/permissions/bulk')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({
      items: [
        { capability: 'books.delete', effect: 'deny' },
        { capability: 'permits.revoke', effect: null },
      ],
    })
    vi.unstubAllGlobals()
  })
})
