import { describe, expect, it } from 'vitest'

import { fileViewerItem } from './fileViewerItem'

describe('fileViewerItem', () => {
  it('sends PDFs, by media type or by name, through the base64 URL and links images directly', () => {
    expect(fileViewerItem({ name: 'note.pdf', mediaType: 'application/octet-stream', url: '/api/v1/x?v=2' })).toMatchObject({
      kind: 'pdf', imageUrl: undefined, pdfBase64Url: '/api/v1/x?v=2&encoding=base64', openUrl: '/api/v1/x?v=2',
    })
    expect(fileViewerItem({ name: 'scan', mediaType: 'application/pdf', url: '/f/1' }).pdfBase64Url).toBe('/f/1?encoding=base64')
    expect(fileViewerItem({ name: 'note.webp', mediaType: 'image/webp', url: '/f/2' })).toMatchObject({
      kind: 'image', imageUrl: '/f/2', pdfBase64Url: undefined, downloadUrl: '/f/2',
    })
  })
})
