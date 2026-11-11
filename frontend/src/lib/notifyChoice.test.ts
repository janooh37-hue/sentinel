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

  it('sends exactly what the switch shows while the default is unknown', () => {
    // Template/preview request slow or failed: the switch reads on, and the
    // backend must not silently apply a default the operator never saw.
    expect(effectiveNotify(null, undefined)).toBe(true)
    expect(notifyEmployeeField(null, undefined)).toBe(true)
    expect(notifyEmployeeField(false, undefined)).toBe(false)
    // Off and back on still forces a send.
    expect(notifyEmployeeField(true, undefined)).toBe(true)
  })
})
