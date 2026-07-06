/**
 * TemplateForm helper tests — `findViolationOthersField`.
 *
 * The Violation Form's `explanation` free-text is hosted *inside* the violation
 * grid (revealed by the "Others" checkbox), so TemplateForm must absorb it: skip
 * its standalone render and hand its key to ViolationCheckboxesField. This helper
 * decides which field (if any) gets absorbed.
 */

import { describe, it, expect } from 'vitest'

import { findViolationOthersField } from './templateFieldHelpers'
import type { TemplateField } from './types'

const violations: TemplateField = {
  id: 'violations',
  type: 'violation_checkboxes',
  label_en: 'Violations',
  label_ar: 'المخالفات',
  required: true,
}
const explanation: TemplateField = {
  id: 'explanation',
  type: 'textarea',
  label_en: 'Explanation / Remarks',
  label_ar: 'التفسير / الملاحظات',
}

describe('findViolationOthersField', () => {
  it('returns the explanation field when a violation_checkboxes field is present', () => {
    expect(findViolationOthersField([violations, explanation])?.id).toBe('explanation')
  })

  it('returns null when there is no violation_checkboxes field', () => {
    expect(findViolationOthersField([explanation])).toBeNull()
  })

  it('returns null when there is no explanation field to absorb', () => {
    expect(findViolationOthersField([violations])).toBeNull()
  })
})
