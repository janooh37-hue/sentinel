import { describe, expect, it } from 'vitest'

import { resolveVehicleClass } from './vehicleForm'

describe('resolveVehicleClass', () => {
  it.each([
    ['بيك اب  ثقيل', 'بيك أب ثقيل', 'Heavy pickup'],
    ['بيك اب ثقيل', 'بيك أب ثقيل', 'Heavy pickup'],
    ['فرع الامن', 'فرع الأمن', 'Security branch'],
  ])('normalizes the known legacy class %s', (legacy, ar, en) => {
    expect(resolveVehicleClass(legacy, null)).toEqual({ ar, en })
  })

  it('preserves an unknown pair for the custom-class path', () => {
    expect(resolveVehicleClass('فئة مخصصة للمهمة', 'Mission custom class')).toBeNull()
  })
})
