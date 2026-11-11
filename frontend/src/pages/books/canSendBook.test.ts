import { describe, expect, it } from 'vitest'
import { canSendBook, canSubmitRecord } from './canSendBook'

const base = { can_send: true, grade: 'secret', created_by_user_id: 7, current_template_id: 'Leave Form', metadata_only: false } as const

describe('canSendBook', () => {
  it('offers Send when the server allows it', () => {
    expect(canSendBook(base, 1)).toBe(true)
  })
  it('hides Send when the server does not allow it', () => {
    expect(canSendBook({ ...base, can_send: false }, 7)).toBe(false)
  })
  it('hides Send on a Ledger Book even when can_send is true', () => {
    expect(canSendBook({ ...base, current_template_id: 'Ledger Book' }, 7)).toBe(false)
  })
  it('hides Send on a metadata-only row', () => {
    expect(canSendBook({ ...base, metadata_only: true }, 7)).toBe(false)
  })
  it.each(['top_secret', 'addressee_only'] as const)('limits %s to its creator', (grade) => {
    expect(canSendBook({ ...base, grade }, 7)).toBe(true)
    expect(canSendBook({ ...base, grade }, 8)).toBe(false)
    expect(canSendBook({ ...base, grade }, undefined)).toBe(false)
  })
})
describe('canSubmitRecord', () => {
  const book = { can_write: true, current_template_id: 'Leave Form' }
  it('needs the capability and write access', () => {
    expect(canSubmitRecord(book, true)).toBe(true)
    expect(canSubmitRecord(book, false)).toBe(false)
    expect(canSubmitRecord({ ...book, can_write: false }, true)).toBe(false)
  })
  it('never offers the generic submit on a Ledger Book', () => {
    expect(canSubmitRecord({ ...book, current_template_id: 'Ledger Book' }, true)).toBe(false)
  })
})
