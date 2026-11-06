import { describe, expect, it } from 'vitest'

import { effectiveNotify, notifyEmployeeField } from './notifyChoice'

describe('notifyChoice', () => {
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
