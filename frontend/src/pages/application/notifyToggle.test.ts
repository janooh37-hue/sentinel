import { describe, it, expect } from 'vitest'
import { effectiveNotify, notifyEmployeeField, shouldShowNotifyToggle } from './notifyToggle'

describe('notifyToggle', () => {
  it('shows when metadata and global auto-send are enabled for a non-revision', () => {
    expect(shouldShowNotifyToggle({
      notifiesEmployee: true,
      autosendEnabled: true,
      isRevision: false,
    })).toBe(true)
  })

  it('hides when template metadata does not notify employees', () => {
    expect(shouldShowNotifyToggle({
      notifiesEmployee: false,
      autosendEnabled: true,
      isRevision: false,
    })).toBe(false)
  })

  it('hides when global auto-send is disabled', () => {
    expect(shouldShowNotifyToggle({
      notifiesEmployee: true,
      autosendEnabled: false,
      isRevision: false,
    })).toBe(false)
  })

  it('hides for revisions', () => {
    expect(shouldShowNotifyToggle({
      notifiesEmployee: true,
      autosendEnabled: true,
      isRevision: true,
    })).toBe(false)
  })

  it.each([true, false])('seeds the switch from the event default (%s) until touched', (defaultEnabled) => {
    expect(effectiveNotify(null, defaultEnabled)).toBe(defaultEnabled)
    expect(effectiveNotify(!defaultEnabled, defaultEnabled)).toBe(!defaultEnabled)
  })

  it.each([true, false])('omits notify_employee unless the choice departs from the default (%s)', (defaultEnabled) => {
    expect(notifyEmployeeField(null, defaultEnabled)).toBeUndefined()
    // Flipped and flipped back: back on the default, so the backend decides.
    expect(notifyEmployeeField(defaultEnabled, defaultEnabled)).toBeUndefined()
    expect(notifyEmployeeField(!defaultEnabled, defaultEnabled)).toBe(!defaultEnabled)
  })
})
