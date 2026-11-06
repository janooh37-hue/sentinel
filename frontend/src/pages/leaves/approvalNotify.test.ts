import { describe, expect, it } from 'vitest'

import { leaveApprovalEvent } from './approvalNotify'

describe('leaveApprovalEvent', () => {
  it.each([
    ['Sick Leave', 'sick_leave_registered'],
    ['Sick Leave - إجازة مرضية', 'sick_leave_registered'],
    ['Sick', 'sick_leave_registered'],
    ['Administrative Leave', 'admin_leave'],
    ['Administrative Leave - إجازة إدارية', 'admin_leave'],
    ['Annual Leave', 'leave_approved'],
    ['Emergency Leave', 'leave_approved'],
    ['Unpaid Leave', 'leave_approved'],
  ])('%s approves with %s', (leaveType, event) => {
    expect(leaveApprovalEvent(leaveType)).toBe(event)
  })
})
