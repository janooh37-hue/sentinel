/**
 * Per-record "Notify employee" choice over the event's default-send setting.
 * Shared by the form save screen and the leave Approve action.
 */

/** `defaultEnabled` is undefined until the event default has loaded (or when
 *  its request failed); the switch then reads on, as before this setting existed. */
type EventDefault = boolean | undefined

/** The switch shows the operator's choice, or the event default until they touch it. */
export function effectiveNotify(choice: boolean | null, defaultEnabled: EventDefault): boolean {
  return choice ?? defaultEnabled ?? true
}

/** `notify_employee` for the request: only a choice that departs from a known
 *  event default is sent; otherwise omitted so the backend applies (and logs) the
 *  default. While the default is unknown, send exactly what the switch shows. */
export function notifyEmployeeField(choice: boolean | null, defaultEnabled: EventDefault): boolean | undefined {
  if (defaultEnabled === undefined) return effectiveNotify(choice, defaultEnabled)
  return choice === null || choice === defaultEnabled ? undefined : choice
}
