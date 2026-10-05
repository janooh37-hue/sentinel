/**
 * Record navigation context — how a record page knows which list it came from,
 * which records flank it, and how to get back to the same row.
 *
 * Every list-originated open carries `RecordNavState { from, queue, scrollY }`
 * in the history entry's state (`openRecord`, or `recordLinkProps` for a real
 * `<Link>` so middle/Ctrl-click still work). On the record page:
 *
 *   - J/K and prev/next call `step`, which REPLACES the entry and forwards the
 *     state, so walking a list never grows history and Back still lands on the
 *     list;
 *   - `back` navigates to `from` with `state { focusBookId, scrollY }`, which the
 *     list reads through `useListReturnFocus` to restore scroll and reveal the
 *     row the reader ended on.
 *
 * `from` is stored WITHOUT its `open` param: BooksPage treats a mount with
 * `?open=<id>` as a deep link and, on phone or when the row is outside the
 * fetched window, bounces straight back into that record.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { NavigateFunction } from 'react-router-dom'

import { APPROVALS_LOG_PATH, approvalRecordUrl } from '@/lib/approvals'
import type { ApprovalContext } from '@/lib/approvals'
import { useAwaitingQueue } from './useAwaitingQueue'
import type { AwaitingQueue } from './useAwaitingQueue'

export interface RecordNavState {
  /** The list URL (path + search) the record was opened from, without `open`. */
  from: string
  /** Record ids of that list, in display order, for J/K and prev/next. */
  queue: number[]
  /** The list scroller's `scrollTop` at the moment of opening. */
  scrollY: number
}

/** The state a list receives when the reader comes Back from a record. */
export interface ListReturnState {
  focusBookId: number
  scrollY: number
}

export function isRecordNavState(value: unknown): value is RecordNavState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<RecordNavState>
  return (
    typeof v.from === 'string' &&
    v.from.length > 0 &&
    Array.isArray(v.queue) &&
    typeof v.scrollY === 'number'
  )
}

function isListReturnState(value: unknown): value is ListReturnState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<ListReturnState>
  return typeof v.focusBookId === 'number' && Number.isFinite(v.focusBookId)
}

/** `url` without its `open` query param (path, other params and hash kept). */
export function stripOpenParam(url: string): string {
  const hashAt = url.indexOf('#')
  const hash = hashAt === -1 ? '' : url.slice(hashAt)
  const rest = hashAt === -1 ? url : url.slice(0, hashAt)
  const queryAt = rest.indexOf('?')
  if (queryAt === -1) return url
  const path = rest.slice(0, queryAt)
  const params = new URLSearchParams(rest.slice(queryAt + 1))
  if (!params.has('open')) return url
  params.delete('open')
  const search = params.toString()
  return `${path}${search ? `?${search}` : ''}${hash}`
}

function normalized(nav: RecordNavState): RecordNavState {
  return { from: stripOpenParam(nav.from), queue: nav.queue, scrollY: nav.scrollY }
}

/** Open a record from a list, carrying the navigation context. */
export function openRecord(navigate: NavigateFunction, id: number, nav: RecordNavState): void {
  navigate(`/books/${id}`, { state: normalized(nav) })
}

/** `<Link>` props for the same open — a real anchor keeps middle-click,
 *  Ctrl/Cmd-click and "open in new tab" working. */
export function recordLinkProps(
  id: number,
  nav: RecordNavState,
): { to: string; state: RecordNavState } {
  return { to: `/books/${id}`, state: normalized(nav) }
}

export interface RecordNavContext {
  /** Back to the originating list (focused on this record), else `/books`. */
  back: () => void
  /** Step to another record in the queue; replaces the history entry. */
  step: (id: number, versionId?: number | null) => void
  /** Approval-log neighbours in an approval context, else derived from the
   *  list's `queue`. */
  queue: AwaitingQueue
  /** The originating list URL (no `open`), or null for a direct open. */
  from: string | null
  /** The forwarded state, null when the record was opened directly. */
  navState: RecordNavState | null
}

const EMPTY_QUEUE: AwaitingQueue = {
  position: null,
  total: 0,
  prevId: null,
  prevVersionId: null,
  nextId: null,
  nextVersionId: null,
}

function queueFromIds(
  allIds: readonly number[],
  bookId: number | null,
  hiddenIds?: ReadonlySet<number>,
): AwaitingQueue {
  // Records mid-delete drop out of the walk (the open record itself stays put).
  const ids = hiddenIds?.size ? allIds.filter((id) => id === bookId || !hiddenIds.has(id)) : allIds
  const at = bookId === null ? -1 : ids.indexOf(bookId)
  if (at === -1) return { ...EMPTY_QUEUE, total: ids.length }
  return {
    position: at + 1,
    total: ids.length,
    prevId: ids[at - 1] ?? null,
    prevVersionId: null,
    nextId: ids[at + 1] ?? null,
    nextVersionId: null,
  }
}

export function useRecordNavContext({
  bookId,
  versionId,
  approvalContext,
  hiddenIds,
}: {
  /** The record on screen. */
  bookId: number | null
  /** Its current version (scopes the approval-log neighbours). */
  versionId: number | null
  /** The approvals-log context parsed from the URL; null outside it. */
  approvalContext: ApprovalContext | null
  /** Records whose delete is pending; queue neighbours never include them. */
  hiddenIds?: ReadonlySet<number>
}): RecordNavContext {
  const navigate = useNavigate()
  const location = useLocation()
  const navState = isRecordNavState(location.state) ? location.state : null

  const approvalQueue = useAwaitingQueue(
    bookId,
    versionId,
    approvalContext,
    approvalContext != null,
    hiddenIds,
  )
  const queue = useMemo(
    () => (approvalContext ? approvalQueue : queueFromIds(navState?.queue ?? [], bookId, hiddenIds)),
    [approvalContext, approvalQueue, navState, bookId, hiddenIds],
  )

  const back = useCallback(() => {
    if (navState && bookId !== null) {
      const state: ListReturnState = { focusBookId: bookId, scrollY: navState.scrollY }
      navigate(stripOpenParam(navState.from), { state })
      return
    }
    navigate('/books')
  }, [bookId, navState, navigate])

  const step = useCallback(
    (id: number, nextVersionId?: number | null) => {
      // Never carries `paper`: the paper choice belongs to one record only.
      const url = approvalContext
        ? approvalRecordUrl(id, nextVersionId ?? null, approvalContext)
        : `/books/${id}`
      navigate(url, { replace: true, state: navState })
    },
    [approvalContext, navState, navigate],
  )

  return {
    back,
    step,
    queue,
    from: navState ? stripOpenParam(navState.from) : null,
    navState,
  }
}

/**
 * A short label for the list a record was opened from ("Pending", "Drafts",
 * "Created by me", "Approvals"), or null when the list carried no narrowing
 * filter. Feeds the Back tooltip's `{{filter}}`.
 */
export function describeListFrom(
  from: string | null,
  t: (key: string) => string,
): string | null {
  if (!from) return null
  const queryAt = from.indexOf('?')
  const path = (queryAt === -1 ? from : from.slice(0, queryAt)).replace(/\/+$/, '')
  if (path === APPROVALS_LOG_PATH) return t('books.approvals.title')
  if (path !== '/books') return null
  const params = new URLSearchParams(queryAt === -1 ? '' : from.slice(queryAt + 1))
  if (params.get('mine') === '1') return t('books.list.myRecords')
  if (params.get('drafts') === '1') return t('books.filters.drafts')
  const status = params.get('status')
  const stateKey: Record<string, string> = {
    none: 'books.approval.stateDraft',
    draft: 'books.approval.stateDraft',
    pending: 'books.approval.statePending',
    approved: 'books.approval.stateApproved',
    returned: 'books.approval.stateReturned',
    rejected: 'books.approval.stateRejected',
  }
  if (status && stateKey[status]) return t(stateKey[status])
  return null
}

export interface ListReturnFocusOptions {
  /** Desktop selects the row through `onSelect`; phone flashes the card. */
  isDesktop: boolean
  /** True once the rows are in the DOM (the list query settled). */
  ready: boolean
  /** Desktop: select the row (sets `open` with replace — the existing path). */
  onSelect?: (id: number) => void
  /** Phone: flash the card (no `open`, so no deep-link bounce). */
  onFlash?: (id: number) => void
  /** CSS selector for a row/card by id. Default: `[data-book-id="<id>"]`. */
  rowSelector?: (id: number) => string
}

const defaultRowSelector = (id: number): string => `[data-book-id="${id}"]`
// A selection that never reaches the URL (row filtered out, no `open` support)
// must not leave the state behind forever.
const CLEAR_FALLBACK_MS = 400

/**
 * List side of Back: on mount with `location.state.focusBookId` (set by
 * `useRecordNavContext().back`), restore the scroller to `state.scrollY` once
 * the rows render, bring the row into view, select it (desktop) or flash it
 * (phone), then clear the state with `replace` so a reload or later Back does
 * not repeat it. Same idiom as ApprovalsPage's restore effect.
 */
export function useListReturnFocus(
  scrollerRef: RefObject<HTMLElement | null>,
  { isDesktop, ready, onSelect, onFlash, rowSelector = defaultRowSelector }: ListReturnFocusOptions,
): void {
  const location = useLocation()
  const navigate = useNavigate()
  const returnState = isListReturnState(location.state) ? location.state : null
  const handledKey = useRef<string | null>(null)
  const pendingClear = useRef<number | null>(null)
  const latestLocation = useRef(location)
  const clearTimer = useRef<number | null>(null)
  // Read through refs so the effects below fire on `ready`/location only.
  const latest = useRef({ isDesktop, onSelect, onFlash, rowSelector })

  useEffect(() => {
    latestLocation.current = location
    latest.current = { isDesktop, onSelect, onFlash, rowSelector }
  })

  // 1. Restore scroll, reveal the row, select/flash — once per history entry.
  useEffect(() => {
    if (!returnState || !ready) return
    const key = `${location.key}:${returnState.focusBookId}`
    if (handledKey.current === key) return
    handledKey.current = key
    const { focusBookId, scrollY } = returnState
    const opts = latest.current
    const scroller = scrollerRef.current
    if (scroller && Number.isFinite(scrollY)) scroller.scrollTop = scrollY
    const row = (scroller ?? document).querySelector<HTMLElement>(opts.rowSelector(focusBookId))
    if (!row) {
      // Not rendered (deleted, pending deletion, filtered out): selecting it would
      // write a dead `open` param. Keep the restored scroll, just drop the state.
      navigate(latestLocation.current, { replace: true, state: null })
      return
    }
    // 'nearest' on both: the restored scrollY must survive when the row is already on screen.
    row.scrollIntoView({ block: 'nearest' })
    if (opts.isDesktop) opts.onSelect?.(focusBookId)
    else opts.onFlash?.(focusBookId)
    pendingClear.current = focusBookId
  }, [returnState, ready, location.key, scrollerRef, navigate])

  // 2. Clear the state once the selection (an `open` replace) has landed, so
  //    the clearing navigate never rewinds the URL to the pre-select search.
  useEffect(() => {
    const id = pendingClear.current
    if (id === null) return
    const clear = (): void => {
      pendingClear.current = null
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current)
      clearTimer.current = null
      navigate(latestLocation.current, { replace: true, state: null })
    }
    const opened = new URLSearchParams(location.search).get('open') === String(id)
    if (!latest.current.isDesktop || opened) {
      clear()
      return
    }
    if (clearTimer.current === null) clearTimer.current = window.setTimeout(clear, CLEAR_FALLBACK_MS)
  }, [location, ready, navigate])

  useEffect(
    () => () => {
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current)
    },
    [],
  )
}
