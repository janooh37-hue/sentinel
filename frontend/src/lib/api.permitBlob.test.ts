import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'

/** The base64 preview blob must carry a MIME type or a `blob:` URL renders a
 *  PDF as raw gibberish text in a new tab (the reported permit-paper bug). */
function mockBase64Response(raw: string): void {
  const b64 = btoa(raw)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, text: async () => b64 }) as unknown as Response),
  )
}

describe('permit attachment preview blob typing', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('tags a PDF body as application/pdf', async () => {
    mockBase64Response('%PDF-1.4 fake pdf body')
    const blob = await api.fetchPermitDocumentBlob(1)
    expect(blob.type).toBe('application/pdf')
  })

  it('tags a JPEG body as image/jpeg', async () => {
    mockBase64Response('\xff\xd8\xff\xe0 jfif')
    const blob = await api.fetchPersonDocumentBlob(1, 2)
    expect(blob.type).toBe('image/jpeg')
  })

  it('leaves an unrecognised body typeless (non-regressing)', async () => {
    mockBase64Response('plain nonsense bytes')
    const blob = await api.fetchVehicleDocumentBlob(1, 2)
    expect(blob.type).toBe('')
  })
})
