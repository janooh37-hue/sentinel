/**
 * The 8 document templates whose committed save notifies the employee.
 * Mirrors `TEMPLATE_EVENTS` in backend/app/services/notify_format.py — keep in
 * sync if that map changes.
 */
export const SMS_FORMS: ReadonlySet<string> = new Set([
  'Salary Transfer Request',
  'Salary Deduction Form',
  'Employee Clearance Form',
  'HR Request Form',
  'Passport Release Form',
  'Warning Form',
  'Resignation Letter',
  'Leave Permit Form',
])

/**
 * Show the "Notify employee" switch only for a notifying form, and only when
 * notifications are enabled app-wide — otherwise the switch would do nothing,
 * so it is hidden rather than shown misleadingly "On".
 */
export function shouldShowNotifyToggle(
  templateId: string | null,
  autosendEnabled: boolean,
): boolean {
  return templateId !== null && autosendEnabled && SMS_FORMS.has(templateId)
}
