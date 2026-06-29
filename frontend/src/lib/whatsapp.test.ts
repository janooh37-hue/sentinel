import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendWhatsApp, getWhatsAppStatus } from './api'

describe('whatsapp api', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('POSTs send with event_type + record_id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'sent', message_id: 'wamid.1', error: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const res = await sendWhatsApp('leave_approved', 7)
    expect(res.status).toBe('sent')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/whatsapp/send')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      event_type: 'leave_approved', record_id: 7,
    })
  })

  it('returns null status when last is null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ enabled: true, last: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const result = await getWhatsAppStatus('leave_approved', 7)
    expect(result.last).toBeNull()
    expect(result.enabled).toBe(true)
  })
})
