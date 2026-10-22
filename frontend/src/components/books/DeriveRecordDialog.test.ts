import { describe, expect, it } from 'vitest'
import { deriveLevels } from './derive-levels'

describe('derive level floor', () => {
  it('keeps non-general originals above general and attached secret originals secret', () => {
    for (const attached of [true, false]) {
      expect(deriveLevels('general', attached)).toEqual(['general', 'personal', 'secret', 'directed'])
      expect(deriveLevels('directed', attached)).toEqual(['personal', 'secret', 'directed'])
      expect(deriveLevels('personal', attached)).toEqual(['personal', 'secret', 'directed'])
    }
    expect(deriveLevels('secret', true)).toEqual(['secret'])
    expect(deriveLevels('secret', false)).toEqual(['personal', 'secret', 'directed'])
  })
})
