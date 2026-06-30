import { describe, it, expect } from 'vitest'

import { canonStatus } from './lifecycle'

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
