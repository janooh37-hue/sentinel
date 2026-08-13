// frontend/src/pages/dutyLocations/transferRequest.test.ts
import { describe, expect, it } from 'vitest'
import { buildTransferRequest } from './transferRequest'

describe('buildTransferRequest', () => {
  it('keeps one destination per employee and normalizes empties', () => {
    expect(
      buildTransferRequest({
        moves: [
          { employeeId: 'G1', toUnit: '  السرية الثانية  ', toPost: '  ' },
          { employeeId: 'G2', toUnit: 'السرية الأولى', toPost: ' ليوان ' },
        ],
        recipientId: 3,
        managerId: null,
        cc: ['مدراء الأفرع'],
      }),
    ).toEqual({
      moves: [
        { employee_id: 'G1', to_unit: 'السرية الثانية', to_post: null },
        { employee_id: 'G2', to_unit: 'السرية الأولى', to_post: 'ليوان' },
      ],
      recipient_id: 3,
      manager_id: null,
      cc: ['مدراء الأفرع'],
    })
  })

  it('sends null cc when the list is empty', () => {
    const req = buildTransferRequest({
      moves: [{ employeeId: 'G1', toUnit: 'X', toPost: 'Y' }],
      recipientId: null, managerId: null, cc: [],
    })
    expect(req.cc).toBeNull()
  })
})
