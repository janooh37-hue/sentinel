import { describe, it, expect } from 'vitest'
import { api } from './api'

describe('scanDocumentUrl', () => {
  it('builds the inline document URL for a scan item', () => {
    expect(api.scanDocumentUrl(42)).toMatch(/\/scan-inbox\/42\/document$/)
  })
})
