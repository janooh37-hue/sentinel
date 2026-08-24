/**
 * Approvals log deep-link constants (#31).
 *
 * Lives in its own tiny module (not ApprovalsPage.tsx) so dashboard widgets can
 * link to the log without pulling the whole code-split page into their chunk.
 */

export type ApprovalScope = 'sent' | 'received'

/** The approvals-log route. */
export const APPROVALS_LOG_PATH = '/books/approvals'

/** Deep-link straight into the reviewer's queue — what both dashboard
 *  approval widgets point at. */
export const APPROVALS_RECEIVED_DEEPLINK = `${APPROVALS_LOG_PATH}?tab=received`

export function isApprovalScope(value: string | null): value is ApprovalScope {
  return value === 'sent' || value === 'received'
}
