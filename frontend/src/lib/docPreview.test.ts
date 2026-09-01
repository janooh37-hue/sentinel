import { describe, expect, it } from 'vitest'

import { generatedDocViewerItem } from './docPreview'

describe('generatedDocViewerItem', () => {
  it('builds the shared viewer PDF URLs from a generated document id', () => {
    expect(generatedDocViewerItem({ id: 73, name: 'Leave application' })).toEqual({
      name: 'Leave application',
      kind: 'pdf',
      pdfBase64Url: '/api/v1/documents/73/download?format=pdf&encoding=base64',
      openUrl: '/api/v1/documents/73/download?format=pdf',
      downloadUrl: '/api/v1/documents/73/download?format=pdf',
    })
  })
})
