// frontend/src/pages/dutyLocations/transferRequest.test.ts
import { describe, expect, it } from 'vitest'
import { buildTransferRequest } from './transferRequest'

describe('buildTransferRequest', () => {
  it('builds the new request shape and normalizes empties', () => {
    expect(
      buildTransferRequest({
        employeeIds: ['G1', 'G2'],
        toUnit: '  السرية الثانية  ',
        toPost: '  ',
        recipientId: 3,
        managerId: null,
        cc: ['مدراء الأفرع'],
      }),
    ).toEqual({
      employee_ids: ['G1', 'G2'],
      to_unit: 'السرية الثانية',
      to_post: null,
      recipient_id: 3,
      manager_id: null,
      cc: ['مدراء الأفرع'],
    })
  })

  it('sends null cc when the list is empty', () => {
    const req = buildTransferRequest({
      employeeIds: ['G1'], toUnit: 'X', toPost: 'Y',
      recipientId: null, managerId: null, cc: [],
    })
    expect(req.cc).toBeNull()
  })
})
