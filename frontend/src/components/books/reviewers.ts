/** Pure helpers for the sequential signing approvers and advisory reviewers.
 * Reviewer steps never gate approval. */
import type { BookApprovalStepRead } from '@/lib/api'

const isReviewerKind = (s: BookApprovalStepRead): boolean => s.kind === 'reviewer'

export function approverStep(steps: BookApprovalStepRead[]): BookApprovalStepRead | undefined {
  let active: BookApprovalStepRead | undefined
  for (const step of steps) {
    if (isReviewerKind(step) || step.state === 'approved') continue
    if (!active || step.step_order < active.step_order) active = step
  }
  return active
}

export function approvalStageLabel(stage: string | null | undefined): 'books.approval.branchManager' | 'books.approval.projectManager' | null {
  if (stage === 'branch_manager') return 'books.approval.branchManager'
  if (stage === 'project_manager') return 'books.approval.projectManager'
  return null
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
