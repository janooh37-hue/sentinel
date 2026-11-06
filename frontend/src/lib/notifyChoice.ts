/**
 * Per-record "Notify employee" choice over the event's default-send setting.
 * Shared by the form save screen and the leave Approve action.
 */

/** The switch shows the operator's choice, or the event default until they touch it. */
export function effectiveNotify(choice: boolean | null, defaultEnabled: boolean): boolean {
  return choice ?? defaultEnabled
}

/** `notify_employee` for the request: only a choice that departs from the
 *  event default is sent; otherwise omitted so the backend applies (and logs) the default. */
export function notifyEmployeeField(choice: boolean | null, defaultEnabled: boolean): boolean | undefined {
  return choice === null || choice === defaultEnabled ? undefined : choice
}
