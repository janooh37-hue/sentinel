import { expect, it } from 'vitest'
import { printedCcSchema } from './composerForm'

it('normalizes printed names and accepts an explicit empty CC list', () => {
  expect(printedCcSchema.parse(['  مدير الموارد البشرية  '])).toEqual(['مدير الموارد البشرية'])
  expect(printedCcSchema.parse([])).toEqual([])
})
it('rejects blank, overlong, and more than 20 printed CC names', () => {
  for (const names of [['  '], ['x'.repeat(501)], Array.from({ length: 21 }, (_, i) => `Office ${i}`)]) {
    expect(printedCcSchema.safeParse(names).success).toBe(false)
  }
})
