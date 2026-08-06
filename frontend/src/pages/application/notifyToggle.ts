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
