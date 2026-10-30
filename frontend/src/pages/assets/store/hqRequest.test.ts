import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadDraft } from '@/lib/formDrafts'
import { canOpenHqMaterialRequest, openHqMaterialRequest } from './hqRequest'

beforeEach(() => window.localStorage.clear())

describe('canOpenHqMaterialRequest', () => {
  const granted = (caps: string[]) => (cap: string) => caps.includes(cap)
  const all = ['documents.generate', 'books.view', 'books.service.Material Request Form']

  it('needs the Services gate and the MRF service capability', () => {
    expect(canOpenHqMaterialRequest(granted(all))).toBe(true)
    for (const missing of all) {
      expect(canOpenHqMaterialRequest(granted(all.filter((c) => c !== missing)))).toBe(false)
    }
  })
})

describe('openHqMaterialRequest', () => {
  it('saves the English MRF draft in the legacy row shape and opens the English paper', () => {
    const navigate = vi.fn()
    openHqMaterialRequest(navigate, [
      { code: 'ST-0001', description: 'Gloves', unit: 'Box', qty: 4 },
      { code: 'ST-0002', description: 'Tea', unit: 'Pack', qty: 12 },
    ])

    expect(loadDraft('Material Request Form')).toEqual({
      items: [
        { sno: '1', code: 'ST-0001', description: 'Gloves', unit: 'Box', qty: '4', quantity: '4', remarks: '' },
        { sno: '2', code: 'ST-0002', description: 'Tea', unit: 'Pack', qty: '12', quantity: '12', remarks: '' },
      ],
    })
    expect(navigate).toHaveBeenCalledWith('/services/material_request?paper=en')
  })
})
