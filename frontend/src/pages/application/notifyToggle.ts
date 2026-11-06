export interface NotifyToggleContext {
  notifiesEmployee: boolean
  autosendEnabled: boolean
  isRevision: boolean
}

export function shouldShowNotifyToggle({
  notifiesEmployee,
  autosendEnabled,
  isRevision,
}: NotifyToggleContext): boolean {
  return notifiesEmployee && autosendEnabled && !isRevision
}

/** The switch shows the operator's choice, or the event default until they touch it. */
export function effectiveNotify(choice: boolean | null, defaultEnabled: boolean): boolean {
  return choice ?? defaultEnabled
}

/** `notify_employee` for the save payload: only a choice that departs from the
 *  event default is sent; otherwise omitted so the backend applies (and logs) the default. */
export function notifyEmployeeField(choice: boolean | null, defaultEnabled: boolean): boolean | undefined {
  return choice === null || choice === defaultEnabled ? undefined : choice
}
