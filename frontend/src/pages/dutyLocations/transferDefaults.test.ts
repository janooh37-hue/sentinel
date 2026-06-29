import { beforeEach, describe, expect, it } from 'vitest'
import { loadTransferDefaults, saveTransferDefaults } from './transferDefaults'

describe('transferDefaults', () => {
  beforeEach(() => localStorage.clear())

  it('returns empty defaults when nothing stored', () => {
    expect(loadTransferDefaults()).toEqual({ recipientId: null, managerId: null, cc: [] })
  })

  it('round-trips saved defaults', () => {
    saveTransferDefaults({ recipientId: 4, managerId: 9, cc: ['مدراء الأفرع'] })
    expect(loadTransferDefaults()).toEqual({ recipientId: 4, managerId: 9, cc: ['مدراء الأفرع'] })
  })

  it('survives corrupt storage', () => {
    localStorage.setItem('gssg.dutyTransfer.defaults', '{not json')
    expect(loadTransferDefaults()).toEqual({ recipientId: null, managerId: null, cc: [] })
  })
})
