import { expect, it } from 'vitest'
import cases from '@/test/fixtures/attendance-verdicts.json'
import { minutesPastGrace, rowState, type JudgedDay } from './attendanceModel'

function asJudgedDay(row: (typeof cases)[number]['row']): JudgedDay {
  return { ...row, leave_kind: row.leave_kind as JudgedDay['leave_kind'] }
}

it.each(cases)('$name', (c) => {
  const row = asJudgedDay(c.row)
  expect(rowState(row, { now: new Date(c.now) })).toBe(c.expected.state)
  if (c.expected.state === 'late') {
    expect(minutesPastGrace(row)).toBe(c.expected.minutes_past_grace)
  }
})
