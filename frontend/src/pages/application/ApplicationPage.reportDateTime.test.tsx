/**
 * seedReportDateTime — Inmate Conduct Violations' report_date/report_time
 * pre-fill (Task 9 review: the mockup says both fields start on "now" and
 * stay editable; ApplicationPage.tsx's `defaultValues: {}` left them blank
 * while required). Mirrors ApplicationPage.resignationDateOrder.test.tsx's
 * shape exactly — same renderHook-only strategy (no ApplicationPage mount),
 * same "guard the one place the ordering lives" rationale: a resumed
 * draft's own values must always win over the seed.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useForm } from 'react-hook-form'

import { nowHM, seedReportDateTime } from './resignationDate'

const TODAY = '2026-08-06'
const NOW = '07:15'

function setup() {
  return renderHook(() => useForm<Record<string, unknown>>({ defaultValues: {} }))
}

function run(
  result: ReturnType<typeof setup>['result'],
  hasReportDate: boolean,
  hasReportTime: boolean,
) {
  act(() => {
    seedReportDateTime(result.current, hasReportDate, hasReportTime, TODAY, NOW)
  })
}

describe('seedReportDateTime', () => {
  it('seeds both fields to now when both are present and absent from the form', () => {
    const { result } = setup()
    run(result, true, true)
    expect(result.current.getValues('report_date')).toBe(TODAY)
    expect(result.current.getValues('report_time')).toBe(NOW)
  })

  it('leaves an already-set value alone — a resumed draft (or revise snapshot) wins', () => {
    const { result } = setup()
    act(() => {
      result.current.setValue('report_date', '2026-08-05')
      result.current.setValue('report_time', '23:40')
    })
    run(result, true, true)
    expect(result.current.getValues('report_date')).toBe('2026-08-05')
    expect(result.current.getValues('report_time')).toBe('23:40')
  })

  it('does nothing for a field the template does not declare', () => {
    const { result } = setup()
    run(result, false, false)
    expect(result.current.getValues('report_date')).toBeUndefined()
    expect(result.current.getValues('report_time')).toBeUndefined()
  })
})

describe('nowHM', () => {
  it('emits 24h HH:MM, matching <input type="time">\'s value format', () => {
    expect(nowHM(new Date(2026, 7, 5, 23, 40))).toBe('23:40')
  })

  it('pads single-digit hour and minute', () => {
    expect(nowHM(new Date(2026, 7, 5, 7, 5))).toBe('07:05')
  })
})
