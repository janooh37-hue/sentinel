import { describe, it, expect } from 'vitest'

import {
  actionsFor, canonStatus, displayState, isReturnable, needsAction,
} from './lifecycle'

// The leave/duty notify buttons gate on `canonStatus(leave.status) === 'Approved'`.
// Stored statuses are bilingual ("Approved - موافق") and legacy ("Generated …"),
// so a raw `=== 'Approved'` compare misses every real record. These cases pin the
// canonicalisation the buttons rely on.
describe('canonStatus', () => {
  it('strips the bilingual Arabic half', () => {
    expect(canonStatus('Approved - موافق')).toBe('Approved')
    expect(canonStatus('Pending - انتظار')).toBe('Pending')
  })

  it('aliases legacy Generated to Approved (both bilingual and bare)', () => {
    expect(canonStatus('Generated - تم الإنشاء')).toBe('Approved')
    expect(canonStatus('Generated')).toBe('Approved')
  })

  it('passes through already-canonical values', () => {
    expect(canonStatus('Approved')).toBe('Approved')
    expect(canonStatus('Rejected')).toBe('Rejected')
  })
})

// Only Annual Leave and National Service close out with a Duty Resumption.
// Every other request-group kind is terminal once Approved — no AwaitingReturn,
// no return action, no needs-action nudge. Mirrors leave_lifecycle.py.
const NOT_RETURNABLE = [
  'Compassionate Leave', 'Duty Leave', 'Emergency Leave', 'Hajj Leave',
  'Maternity Leave',
]
const OVERDUE = '2026-06-01'
const TODAY = '2026-07-01'

describe('isReturnable', () => {
  it('is true for Annual Leave and National Service', () => {
    expect(isReturnable('Annual Leave')).toBe(true)
    expect(isReturnable('Annual')).toBe(true)
    expect(isReturnable('Annual Leave - إجازة سنوية')).toBe(true)
    expect(isReturnable('National Service')).toBe(true)
  })

  it('is false for other request kinds and records', () => {
    for (const lt of [...NOT_RETURNABLE, 'Sick Leave', 'Administrative Leave']) {
      expect(isReturnable(lt), lt).toBe(false)
    }
  })
})

describe('non-returnable Approved leaves are terminal', () => {
  it('stays Confirmed even after the end date', () => {
    for (const lt of NOT_RETURNABLE) {
      expect(displayState(lt, 'Approved', OVERDUE, TODAY), lt).toBe('Confirmed')
    }
  })

  it('offers only cancel, never return', () => {
    for (const lt of NOT_RETURNABLE) {
      expect(actionsFor(lt, 'Approved', OVERDUE, TODAY), lt).toEqual(['cancel'])
    }
  })

  it('does not need action once approved', () => {
    for (const lt of NOT_RETURNABLE) {
      expect(needsAction(lt, 'Approved', OVERDUE, TODAY), lt).toBe(false)
    }
  })

  it('still needs approval while Pending', () => {
    for (const lt of NOT_RETURNABLE) {
      expect(needsAction(lt, 'Pending', OVERDUE, TODAY), lt).toBe(true)
    }
  })
})

describe('Annual Leave still returns', () => {
  it('awaits return once overdue', () => {
    expect(displayState('Annual Leave', 'Approved', OVERDUE, TODAY)).toBe('AwaitingReturn')
    expect(actionsFor('Annual Leave', 'Approved', OVERDUE, TODAY)).toEqual(['return', 'cancel'])
    expect(needsAction('Annual Leave', 'Approved', OVERDUE, TODAY)).toBe(true)
  })
})
