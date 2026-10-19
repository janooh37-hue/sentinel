import { describe, expect, it } from 'vitest'

import { QUICK_ACTION_META } from './quickActions'

const calibratedArtwork = {
  'Acknowledgment Form': 'acknowledgment',
  'Salary Transfer Request': 'salary-transfer',
  'Salary Deduction Form': 'salary-deduction',
  'Violation Form': 'violation',
  'Employee Clearance Form': 'employee-clearance',
  'Leave Application Form': 'leave-application',
  'Passport Release Form': 'passport-release',
  'Duty Resumption Form': 'duty-resumption',
  'Material Request Form': 'material-request',
  'General Book': 'general-book',
  'HR Request Form': 'hr-request',
  'Resignation Letter': 'resignation-letter',
  'Leave Permit Form': 'leave-permit',
  'Administrative Leave Form': 'administrative-leave',
  'Warning Form': 'warning',
  'Passport Release List': 'passport-release-list',
  Report: 'report',
  'Inmate Conduct Violations': 'inmate-conduct',
} as const

describe('quick-action service artwork', () => {
  it('registers calibrated artwork for every service form', () => {
    const actual = Object.fromEntries(
      Object.entries(QUICK_ACTION_META).map(([id, meta]) => [id, meta.artwork]),
    )

    expect(actual).toEqual(calibratedArtwork)
  })
})
