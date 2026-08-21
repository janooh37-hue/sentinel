/**
 * The workbook filename, taken from `content-disposition`.
 *
 * The deliverables' names are Arabic, so FastAPI sends them RFC 5987 encoded.
 * What matters here is the FALLBACK path: when the encoded form is unusable the
 * caller's own name must be what lands on disk, never a fragment of the header.
 * A workbook saved under a garbage name is a wrong file sent to a client.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from './api'

function mockAttachment(disposition: string | null): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        ({
          ok: true,
          blob: async () => new Blob(['workbook']),
          headers: {
            get: (name: string) =>
              name.toLowerCase() === 'content-disposition' ? disposition : null,
          },
        }) as unknown as Response,
    ),
  )
}

const MONTH = { year: 2026, month: 7, sheet: 'main', variant: 'attendance' } as const

describe('timesheet export filename', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('decodes the RFC 5987 form', async () => {
    mockAttachment("attachment; filename*=UTF-8''%D9%83%D8%B4%D9%81.xlsx")
    const file = await api.fetchTimesheetExport(MONTH, 'fallback.xlsx')
    expect(file.filename).toBe('كشف.xlsx')
  })

  it('prefers the encoded form over the ASCII one', async () => {
    mockAttachment('attachment; filename="kashf.xlsx"; filename*=UTF-8\'\'%D9%83.xlsx')
    const file = await api.fetchTimesheetExport(MONTH, 'fallback.xlsx')
    expect(file.filename).toBe('ك.xlsx')
  })

  it('falls back to the caller name when the escape is malformed, never to header text', async () => {
    // `%D9` is an incomplete UTF-8 sequence, so `decodeURIComponent` throws and
    // the plain-form regex runs against a header that has no plain form. It
    // must not capture the `*=UTF-8''…` tail.
    mockAttachment("attachment; filename*=UTF-8''%D9")
    const file = await api.fetchTimesheetExport(MONTH, 'كشف حضور شهر يوليو.xlsx')
    expect(file.filename).toBe('كشف حضور شهر يوليو.xlsx')
    expect(file.filename).not.toContain('UTF-8')
    expect(file.filename).not.toContain('*=')
  })

  it('falls back when the header is absent entirely', async () => {
    mockAttachment(null)
    const file = await api.fetchTimesheetExport(MONTH, 'fallback.xlsx')
    expect(file.filename).toBe('fallback.xlsx')
  })
})
