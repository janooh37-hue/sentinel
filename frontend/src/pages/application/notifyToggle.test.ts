import { describe, it, expect } from 'vitest'
import { SMS_FORMS, shouldShowNotifyToggle } from './notifyToggle'

describe('notifyToggle', () => {
  it('covers exactly the 8 notifying forms', () => {
    expect(SMS_FORMS.size).toBe(8)
    expect(SMS_FORMS.has('Employee Clearance Form')).toBe(true)
    expect(SMS_FORMS.has('Leave Permit Form')).toBe(true)
  })

  it('shows for a notifying form when autosend is on', () => {
    expect(shouldShowNotifyToggle('Employee Clearance Form', true)).toBe(true)
  })

  it('hides for a non-notifying form', () => {
    expect(shouldShowNotifyToggle('General Book', true)).toBe(false)
  })

  it('hides when autosend is off app-wide', () => {
    expect(shouldShowNotifyToggle('Employee Clearance Form', false)).toBe(false)
  })

  it('hides when no template is selected', () => {
    expect(shouldShowNotifyToggle(null, true)).toBe(false)
  })
})
