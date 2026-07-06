/**
 * Pure helpers for TemplateForm field dispatch — kept out of the component file
 * so exporting them doesn't trip the react-refresh only-export-components rule.
 */

import type { TemplateField } from './types'

/**
 * The Violation Form's `explanation` free-text is hosted *inside* the violation
 * grid (revealed by the "Others" checkbox), so ViolationCheckboxesField absorbs
 * it rather than letting it render standalone. Returns the field to absorb (the
 * `explanation` field) when a `violation_checkboxes` field exists in this
 * schema, else null.
 */
export function findViolationOthersField(
  fields: TemplateField[],
): TemplateField | null {
  if (!fields.some((f) => f.type === 'violation_checkboxes')) return null
  return fields.find((f) => f.id === 'explanation') ?? null
}
