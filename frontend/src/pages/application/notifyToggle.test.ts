import { describe, it, expect } from 'vitest'
import { shouldShowNotifyToggle } from './notifyToggle'

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
})
