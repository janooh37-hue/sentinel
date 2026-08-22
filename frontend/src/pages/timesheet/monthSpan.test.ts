/**
 * The month-coordinate helpers `useTimesheet` exports.
 *
 * They were private to one caller each until the employee record needed the
 * same answers; now they are shared infrastructure. Two of them answer "which
 * month" for two different surfaces — `currentMonth` for the page the operator
 * edits in, `lastCompletedMonth` for the workbook an employee record offers —
 * so the pair is pinned on one shared date as well as separately: two answers
 * by design is one careless edit away from two answers by accident.
 *
 * `lastCompletedMonth` takes an injectable `now` precisely so the January case
 * can be asserted rather than reasoned about, which is the exact trap this
 * feature keeps hitting: December→January is a year change AND a month change,
 * and every naive form gets one of the two wrong.
 *
 * No mocks: these are pure functions.
 */
import { describe, expect, it } from 'vitest'

import {
  currentMonth,
  lastCompletedMonth,
  previousMonth,
  spanMonthLabels,
} from './useTimesheet'

describe('currentMonth', () => {
  it('is the month in progress, 1-based', () => {
    // 22 Aug 2026 → August 2026. `getMonth()` is 0-based, so the month being
    // worked in is the one AFTER it.
    expect(currentMonth(new Date(2026, 7, 22))).toEqual({ year: 2026, month: 8 })
  })

  it('stays inside January instead of rolling back a year', () => {
    // The mirror of `lastCompletedMonth`'s trap: the month in progress never
    // crosses a boundary, so borrowing that function's roll-back branch here
    // would name a month that has not started.
    expect(currentMonth(new Date(2026, 0, 5))).toEqual({ year: 2026, month: 1 })
  })

  it('names a different month than lastCompletedMonth on the same day', () => {
    // The page opens on the month being edited; an employee record offers the
    // month that closed. They disagree on purpose, and this is where that is
    // written down.
    const day = new Date(2026, 7, 22)
    expect(currentMonth(day)).toEqual({ year: 2026, month: 8 })
    expect(lastCompletedMonth(day)).toEqual({ year: 2026, month: 7 })
  })
})

describe('lastCompletedMonth', () => {
  it('is last month inside a year', () => {
    // 21 Aug 2026 → July 2026. `getMonth()` is 0-based, so it already IS the
    // 1-based previous month.
    expect(lastCompletedMonth(new Date(2026, 7, 21))).toEqual({ year: 2026, month: 7 })
  })

  it('crosses back into the previous December in January', () => {
    // The branch nothing else exercises: month 0 must roll BOTH the month to 12
    // and the year to 2025. Returning `{ year: 2026, month: 12 }` would read a
    // month that has not happened; `{ year: 2025, month: 0 }` is not a month.
    expect(lastCompletedMonth(new Date(2026, 0, 5))).toEqual({ year: 2025, month: 12 })
    expect(lastCompletedMonth(new Date(2026, 0, 31))).toEqual({ year: 2025, month: 12 })
  })
})

describe('previousMonth', () => {
  it('steps back inside a year', () => {
    expect(previousMonth(2026, 3)).toEqual({ year: 2026, month: 2 })
  })

  it('steps back across the year boundary', () => {
    expect(previousMonth(2026, 1)).toEqual({ year: 2025, month: 12 })
  })
})

describe('spanMonthLabels', () => {
  it('names only the later month with its year inside one year', () => {
    // The later month carries the year because it names the file; repeating it
    // on the earlier one is noise.
    expect(spanMonthLabels(2026, 3, 'en')).toEqual({
      first: 'February',
      second: 'March 2026',
    })
  })

  it('gives the earlier month its own year across the boundary', () => {
    // "December and January 2026" would be a lie — December was 2025.
    expect(spanMonthLabels(2026, 1, 'en')).toEqual({
      first: 'December 2025',
      second: 'January 2026',
    })
  })

  it('names the months in the language it is asked for', () => {
    expect(spanMonthLabels(2026, 3, 'ar')).toEqual({
      first: 'فبراير',
      second: 'مارس 2026',
    })
  })
})
