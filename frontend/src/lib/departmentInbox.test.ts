import { describe, expect, it } from 'vitest'
import { distributionPayload, orderDepartmentSends } from './departmentInbox'

describe('department inbox', () => {
  it('only submits targets belonging to the chosen distribution mode', () => {
    expect(distributionPayload('all', [7], 8, 'info', '  ')).toEqual({ mode: 'all', purpose: 'info', note: null })
    expect(distributionPayload('members', [7], 8, 'action', ' note ')).toEqual({ mode: 'members', user_ids: [7], purpose: 'action', note: 'note' })
    expect(distributionPayload('subdepartment', [7], 8, 'reply', '')).toEqual({ mode: 'subdepartment', subdepartment_id: 8, purpose: 'reply', note: null })
  })

  it('orders children under parents and retains orphaned or cyclic history', () => {
    const sends = [
      { id: 2, parent_send_id: 1 },
      { id: 3, parent_send_id: 99 },
      { id: 1, parent_send_id: null },
      { id: 4, parent_send_id: 5 },
      { id: 5, parent_send_id: 4 },
    ]
    expect(orderDepartmentSends(sends).map(({ send, depth }) => [send.id, depth])).toEqual([[3, 0], [1, 0], [2, 1], [4, 0], [5, 1]])
  })
})
