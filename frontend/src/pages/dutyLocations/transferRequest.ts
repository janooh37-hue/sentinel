/**
 * Pure builder for the `/duty/transfer` request body, kept in its own module so
 * the TransferDialog component file only exports a component (react-refresh).
 */

import type { DutyTransferRequest } from '@/lib/api'

/** Build the `/duty/transfer` request body from form state. Trims strings and
 *  normalizes empty post/reason to null. */
export function buildTransferRequest(input: {
  employeeIds: readonly string[]
  toUnit: string
  toPost: string
  effectiveDate: string
  reason: string
}): DutyTransferRequest {
  return {
    employee_ids: [...input.employeeIds],
    to_unit: input.toUnit.trim(),
    to_post: input.toPost.trim() || null,
    effective_date: input.effectiveDate,
    reason: input.reason.trim() || null,
  }
}
