/**
 * Pure builder for the `/duty/transfer` request body, kept in its own module so
 * the TransferDialog component file only exports a component (react-refresh).
 */
import type { DutyTransferRequest } from '@/lib/api'

export function buildTransferRequest(input: {
  employeeIds: readonly string[]
  toUnit: string
  toPost: string
  recipientId: number | null
  managerId: number | null
  cc: readonly string[]
}): DutyTransferRequest {
  return {
    employee_ids: [...input.employeeIds],
    to_unit: input.toUnit.trim(),
    to_post: input.toPost.trim() || null,
    recipient_id: input.recipientId,
    manager_id: input.managerId,
    cc: input.cc.length > 0 ? [...input.cc] : null,
  }
}
