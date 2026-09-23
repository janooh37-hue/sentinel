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
 * - caller is an advisory reviewer with a still-pending review step → `review`,
 *   REGARDLESS of aggregate state: a reviewer's pending step remains
 *   actionable — late advisory feedback — after the signer has already
 *   approved, returned, or rejected the reviewed revision. Checked before the
 *   state-gated branches below so it is never confined to `pending`.
 * - `returned`/`rejected` + revise authority (`books.edit`, `canRevise`) → `revise`
 * - `none` + submit authority (`books.submit`, `canSubmitBook`) → `submit`
 *   (independent of `canRevise`: submitting a draft does not require edit rights)
 * - `awaiting_scan` → no footer action (the scan-back upload is the move,
 *   driven from the Records pane / ＋Add-scan — not a drawer decision)
 * - otherwise read-only (`none`)
 */
export function footerActionFor(
  state: string,
  caps: {
    canRevise: boolean
    canSubmitBook: boolean
    canApprove: boolean
    isAssignee: boolean
    isReviewer?: boolean
  },
): FooterAction {
  if (state === 'pending' && caps.canApprove && caps.isAssignee) return 'decide'
  if (caps.isReviewer) return 'review'
  if (state === 'awaiting_scan') return 'none'
  if ((state === 'returned' || state === 'rejected') && caps.canRevise) return 'revise'
  if (state === 'none' && caps.canSubmitBook) return 'submit'
  return 'none'
}

/**
 * Whether an admin may file a physically-signed scan back onto the record.
 * Independent of `footerActionFor` / assignee: an operator who handles requests
 * for others (print → sign on paper → scan back) needs this on a draft (`none`,
 * the paper route as a first move), while a request is out for in-app signature
 * (`pending`), or when the paper is explicitly at the printer (`awaiting_scan`).
 * Approved/returned/rejected don't take a signed copy here (those have their own
 * moves). Requires both `books.edit` and `documents.scan` — the same gate the
 * Records pane uses for ＋Add-scan.
 */
export function canFileSignedCopy(
  state: string,
  caps: { canEdit: boolean; canScan: boolean },
): boolean {
  return (
    caps.canEdit &&
    caps.canScan &&
    (state === 'none' || state === 'pending' || state === 'awaiting_scan')
  )
}

/**
 * Whether the "Send for approval" (digital route) action shows — i.e. submit a
 * draft, or RE-ROUTE a still-pending request to a different signing manager.
 * Mirrors the backend `submit_for_approval`, which rebuilds the chain for
 * `none`/`pending` but rejects `awaiting_scan` ("file the scan instead") and an
 * already-approved version. Requires `books.submit`.
 */
export function canSendForApproval(state: string, caps: { canSubmitBook: boolean }): boolean {
  return caps.canSubmitBook && (state === 'none' || state === 'pending')
}

export type InmateReporterAction = 'edit-submit' | 'correct-resubmit' | 'read-only'

/** The restricted reporter's complete state/ownership action matrix. */
export function inmateReporterActionFor(
  book: { approval_state: string; original_creator_user_id?: number | null },
  userId: number | undefined,
): InmateReporterAction {
  const ownsReport = userId !== undefined && book.original_creator_user_id === userId
  if (ownsReport && book.approval_state === 'none') return 'edit-submit'
  if (ownsReport && book.approval_state === 'returned') return 'correct-resubmit'
  return 'read-only'
}
