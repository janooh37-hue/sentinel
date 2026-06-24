/** Pure helpers for partitioning the approval chain into the single approver
 *  (the signing manager) and the advisory reviewers. Mirrors the backend kind
 *  split; reviewer steps never gate. Sibling-module pattern (react-refresh). */
import type { BookApprovalStepRead } from '@/lib/api'

const isReviewerKind = (s: BookApprovalStepRead): boolean => s.kind === 'reviewer'

export function approverStep(steps: BookApprovalStepRead[]): BookApprovalStepRead | undefined {
  return steps.find((s) => !isReviewerKind(s)) // kind undefined (legacy) = approver
}
export function reviewerSteps(steps: BookApprovalStepRead[]): BookApprovalStepRead[] {
  return steps.filter(isReviewerKind)
}
export function myPendingReviewerStep(
  steps: BookApprovalStepRead[], userId: number | undefined,
): BookApprovalStepRead | undefined {
  if (userId == null) return undefined
  return steps.find((s) => isReviewerKind(s) && s.assignee_user_id === userId && s.state === 'pending')
}
export function isApproverAssignee(steps: BookApprovalStepRead[], userId: number | undefined): boolean {
  const a = approverStep(steps)
  return a != null && a.state === 'pending' && a.assignee_user_id === userId
}
export function changesRequestedCount(steps: BookApprovalStepRead[]): number {
  return reviewerSteps(steps).filter((s) => s.state === 'changes_requested').length
}
export function mySeenStep(steps: BookApprovalStepRead[], userId: number | undefined): BookApprovalStepRead | undefined {
  if (userId == null) return undefined
  return steps.find((s) => isReviewerKind(s) && s.assignee_user_id === userId && s.seen_at != null)
}
