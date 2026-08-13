/**
 * Pure builder for the `/duty/transfer` request body, kept in its own module so
 * the TransferDialog component file only exports a component (react-refresh).
 */
import type { DutyTransferRequest } from '@/lib/api'

/** One row of the transfer dialog: who moves, and where to. */
export interface TransferMoveInput {
  employeeId: string
  toUnit: string
  toPost: string
}

export function buildTransferRequest(input: {
  moves: readonly TransferMoveInput[]
  recipientId: number | null
  managerId: number | null
  cc: readonly string[]
}): DutyTransferRequest {
  return {
    moves: input.moves.map((m) => ({
      employee_id: m.employeeId,
      to_unit: m.toUnit.trim(),
      to_post: m.toPost.trim() || null,
    })),
    recipient_id: input.recipientId,
    manager_id: input.managerId,
    cc: input.cc.length > 0 ? [...input.cc] : null,
  }
}
