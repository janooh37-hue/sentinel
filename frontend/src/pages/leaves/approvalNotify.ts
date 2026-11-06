import { useState } from 'react'

import { useMessageTemplates } from '@/lib/messageTemplates'
import { effectiveNotify, notifyEmployeeField } from '@/pages/application/notifyToggle'

import { classifyLeaveType } from './report/kinds'

/** The message event an approval sends. Mirrors backend
 *  `notify_dispatch.leave_status_event` for the Approved status. */
export function leaveApprovalEvent(leaveType: string): 'sick_leave_registered' | 'admin_leave' | 'leave_approved' {
  const kind = classifyLeaveType(leaveType)
  if (kind === 'Sick Leave') return 'sick_leave_registered'
  if (kind === 'Administrative Leave') return 'admin_leave'
  return 'leave_approved'
}

/** Approve-only "Notify employee" switch, seeded from the approval event's
 *  default until touched. `field` is the `notify_employee` to send (undefined =
 *  let the backend apply the default). Before templates load the default reads on. */
export function useApprovalNotify(leaveType: string) {
  const templates = useMessageTemplates()
  const event = leaveApprovalEvent(leaveType)
  const defaultEnabled = templates.data?.find((template) => template.event === event)?.default_enabled ?? true
  const [choice, setChoice] = useState<boolean | null>(null)
  return {
    checked: effectiveNotify(choice, defaultEnabled),
    onChange: setChoice,
    field: notifyEmployeeField(choice, defaultEnabled),
  }
}
