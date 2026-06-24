/**
 * Pure helpers for BookDetailDrawer, split into a sibling module so the
 * component file stays component-only for react-refresh (repo convention,
 * mirrors `authContext.ts` next to `AuthProvider.tsx`).
 */

export type FooterAction = 'decide' | 'revise' | 'submit' | 'review' | 'none'

/**
 * Decide which footer the drawer shows for a book in `state`, given the
 * caller's capabilities and whether they own the current pending step.
 *
 * - `pending` + caller is the assignee approver → `decide` (approve/reject/return/note)
 * - `pending` + caller is an advisory reviewer → `review`
 * - `returned`/`rejected` + `books.manage` → `revise`
 * - `none` + `books.manage` → `submit`
 * - `awaiting_scan` → no footer action (the scan-back upload is the move,
 *   driven from the Records pane / ＋Add-scan — not a drawer decision)
 * - otherwise read-only (`none`)
 */
export function footerActionFor(
  state: string,
  caps: { canManage: boolean; canApprove: boolean; isAssignee: boolean; isReviewer?: boolean },
): FooterAction {
  if (state === 'awaiting_scan') return 'none'
  if (state === 'pending') {
    if (caps.canApprove && caps.isAssignee) return 'decide'
    if (caps.isReviewer) return 'review'
    return 'none'
  }
  if ((state === 'returned' || state === 'rejected') && caps.canManage) return 'revise'
  if (state === 'none' && caps.canManage) return 'submit'
  return 'none'
}
