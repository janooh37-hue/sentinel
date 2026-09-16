/**
 * Approvals worklist URL/context model (#31, revision-scoped).
 *
 * Lives in its own tiny module (not ApprovalsPage.tsx) so dashboard widgets and
 * the record page can build/consume context-bearing URLs without pulling the
 * whole code-split queue page into their chunk.
 *
 * `ApprovalContext` is the canonical shape of "where in the worklist am I" —
 * carried in the URL so navigating away and back (or opening a record from a
 * row) restores the same tab/kind/filter/sort/page. UI vocabulary is
 * `sign`/`review`; the API vocabulary is `approver`/`reviewer` — this module
 * is the one place that translates between them.
 */
import type {
  ApprovalKindParam,
  ApprovalLogItem,
  ApprovalStatusParam,
  ApprovalSummaryResponse,
} from './api'

export type ApprovalScope = 'sent' | 'received'
export type ApprovalKind = 'sign' | 'review'
export type ApprovalStatus = ApprovalStatusParam
export type ApprovalSort = 'oldest' | 'newest'

export type ApprovalContext =
  | { tab: 'sent'; status: ApprovalStatus; sort: ApprovalSort; page: number }
  | { tab: 'received'; kind: ApprovalKind; status: ApprovalStatus; sort: ApprovalSort; page: number }

/** The approvals-log route. */
export const APPROVALS_LOG_PATH = '/books/approvals'

/** Fixed page size — `page` is one-based; API `offset = (page - 1) * PAGE_SIZE`. */
export const APPROVALS_PAGE_SIZE = 100

export const RECEIVED_STATUSES: readonly ApprovalStatus[] = [
  'pending',
  'returned',
  'approved',
  'rejected',
  'all',
]
export const SENT_STATUSES: readonly ApprovalStatus[] = [
  'all',
  'pending',
  'approved',
  'rejected',
  'returned',
]
const REVIEW_STATUSES: readonly ApprovalStatus[] = ['pending', 'all']
const SORTS: readonly ApprovalSort[] = ['oldest', 'newest']

export function isApprovalScope(value: string | null): value is ApprovalScope {
  return value === 'sent' || value === 'received'
}

function isApprovalKind(value: string | null): value is ApprovalKind {
  return value === 'sign' || value === 'review'
}

function isApprovalStatus(value: string | null, kind?: ApprovalKind): value is ApprovalStatus {
  if (value === null) return false
  const allowed = kind === 'review' ? REVIEW_STATUSES : RECEIVED_STATUSES
  return (allowed as readonly string[]).includes(value)
}

function isApprovalSort(value: string | null): value is ApprovalSort {
  return (SORTS as readonly string[]).includes(value ?? '')
}

/** UI kind -> API kind param. */
export function apiKindOf(kind: ApprovalKind): ApprovalKindParam {
  return kind === 'sign' ? 'approver' : 'reviewer'
}

/** API kind param -> UI kind. */
export function uiKindOf(kind: ApprovalKindParam): ApprovalKind {
  return kind === 'approver' ? 'sign' : 'review'
}

/** True when pending advisory feedback outlives the signing decision. */
export function isLateAdvisory(item: ApprovalLogItem): boolean {
  return (
    item.status === 'pending' &&
    item.record_status != null &&
    item.record_status !== 'pending' &&
    item.record_status !== 'none'
  )
}

/** The generic Approvals landing rule, from the caller's authorized summary:
 *  nonzero signature work first, then review work, then Sent, then any
 *  authorized received kind with its full history, else neutral (no context —
 *  render the no-assigned-work empty state). */
export function defaultApprovalContext(summary: ApprovalSummaryResponse): ApprovalContext | null {
  if (summary.signature.count > 0) {
    return { tab: 'received', kind: 'sign', status: 'pending', sort: 'oldest', page: 1 }
  }
  if (summary.review.count > 0) {
    return { tab: 'received', kind: 'review', status: 'pending', sort: 'oldest', page: 1 }
  }
  if (summary.can_view_sent) {
    return { tab: 'sent', status: 'pending', sort: 'oldest', page: 1 }
  }
  const kinds = summary.available_received_kinds ?? []
  if (kinds.includes('reviewer')) {
    return { tab: 'received', kind: 'review', status: 'all', sort: 'oldest', page: 1 }
  }
  if (kinds.includes('approver')) {
    return { tab: 'received', kind: 'sign', status: 'all', sort: 'oldest', page: 1 }
  }
  return null
}

/** Resolve URL search params into a context authorized by `summary`. Invalid
 *  enum/page values reset that one field to its default; an unauthorized
 *  scope/kind falls back to the generic landing rule (never silently grants
 *  an unauthorized tab). */
export function normalizeApprovalContext(
  params: URLSearchParams,
  summary: ApprovalSummaryResponse,
): ApprovalContext | null {
  const tabParam = params.get('tab')
  const tab = isApprovalScope(tabParam) ? tabParam : null
  const sort = isApprovalSort(params.get('sort')) ? (params.get('sort') as ApprovalSort) : 'oldest'
  const pageValue = Number.parseInt(params.get('page') ?? '', 10)
  const page = Number.isInteger(pageValue) && pageValue >= 1 ? pageValue : 1
  if (tab === 'sent') {
    if (!summary.can_view_sent) return defaultApprovalContext(summary)
    const status = isApprovalStatus(params.get('status')) ? (params.get('status') as ApprovalStatus) : 'all'
    return { tab: 'sent', status, sort, page }
  }

  if (tab === 'received') {
    const kindParam = params.get('kind')
    const kind = isApprovalKind(kindParam) ? kindParam : null
    const available = summary.available_received_kinds ?? []
    if (kind === null || !available.includes(apiKindOf(kind))) {
      return defaultApprovalContext(summary)
    }
    const status = isApprovalStatus(params.get('status'), kind)
      ? (params.get('status') as ApprovalStatus)
      : 'pending'
    return { tab: 'received', kind, status, sort, page }
  }

  return defaultApprovalContext(summary)
}

/** The queue URL for a context — canonicalization target (history.replace). */
export function approvalQueueUrl(context: ApprovalContext): string {
  const usp = new URLSearchParams()
  usp.set('tab', context.tab)
  if (context.tab === 'received') usp.set('kind', context.kind)
  usp.set('status', context.status)
  usp.set('sort', context.sort)
  usp.set('page', String(context.page))
  return `${APPROVALS_LOG_PATH}?${usp.toString()}`
}

/** A record URL carrying the originating queue context, so the record page
 *  can render QueueNav and "back to queue" against the same filtered set.
 *  `versionId` is omitted only for a genuinely versionless full-access record. */
export function approvalRecordUrl(
  bookId: number,
  versionId: number | null,
  context: ApprovalContext,
): string {
  const usp = new URLSearchParams()
  if (versionId !== null) usp.set('version_id', String(versionId))
  usp.set('tab', context.tab)
  if (context.tab === 'received') usp.set('kind', context.kind)
  usp.set('status', context.status)
  usp.set('sort', context.sort)
  usp.set('page', String(context.page))
  const qs = usp.toString()
  return qs ? `/books/${bookId}?${qs}` : `/books/${bookId}`
}

/** Reset to page 1 — every filter/kind/sort change canonicalizes back to the
 *  first page rather than keeping a now-meaningless offset. */
export function resetPage(context: ApprovalContext): ApprovalContext {
  return { ...context, page: 1 }
}
