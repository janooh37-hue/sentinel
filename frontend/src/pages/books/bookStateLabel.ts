/**
 * Path-aware state labels for the Records surfaces (seals, pills, timeline).
 *
 * One source of truth for approval_state → { labelKey, Icon, tone }:
 * - `pending` on the `in_app` signing path reads "Awaiting signature" (the
 *   manager must act in-app) — the stored state value is unchanged.
 * - `approved` with a scan-back signed copy (`signed_source === 'scan'`)
 *   reads "Signed · scanned".
 * - `awaiting_scan` is the scan-path holding state (paper is out of the
 *   system at the printer) — info tone, Printer icon.
 * Unknown states fall back to the raw string on a neutral seal (fail-safe).
 * Color is never the only signal: every tone pairs with a distinct icon
 * (a11y contract).
 */
import type { ComponentType } from 'react'
import { ArrowLeftRight, Check, Clock, Eye, Pencil, PenLine, Printer, X } from 'lucide-react'

export type SealTone = 'neutral' | 'warning' | 'info' | 'success' | 'accent'

export interface SealDescriptor {
  /** i18n key for known states; the raw state string verbatim for unknown ones */
  labelKey: string
  Icon: ComponentType<{ className?: string }>
  tone: SealTone
  /** soft-chip classes for StateSeal-style surfaces */
  toneClasses: string
}

const TONE_CLASSES: Record<SealTone, string> = {
  neutral: 'bg-surface-tinted text-muted-foreground',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success border border-success',
  accent: 'bg-accent-soft text-accent',
}

function make(
  labelKey: string,
  Icon: ComponentType<{ className?: string }>,
  tone: SealTone,
): SealDescriptor {
  return { labelKey, Icon, tone, toneClasses: TONE_CLASSES[tone] }
}

const BASE: Record<string, SealDescriptor> = {
  none: make('books.approval.stateDraft', Pencil, 'neutral'),
  pending: make('books.approval.statePending', Clock, 'warning'),
  awaiting_scan: make('books.approval.stateAwaitingScan', Printer, 'info'),
  approved: make('books.approval.stateApproved', Check, 'success'),
  returned: make('books.approval.stateReturned', ArrowLeftRight, 'info'),
  rejected: make('books.approval.stateRejected', X, 'accent'),
}

export function sealDescriptor(
  state: string,
  opts?: { signingPath?: string | null; signedSource?: string | null },
): SealDescriptor {
  if (state === 'pending' && opts?.signingPath === 'in_app') {
    return make('books.approval.stateAwaitingSignature', PenLine, 'warning')
  }
  if (state === 'approved' && opts?.signedSource === 'scan') {
    return make('books.approval.signedScanned', Check, 'success')
  }
  return BASE[state] ?? make(state, Pencil, 'neutral')
}

/** Reviewer-step state descriptors (shown in ReviewerList rows). */
const REVIEWER: Record<string, SealDescriptor> = {
  pending: make('books.reviewers.awaiting', Eye, 'neutral'),
  reviewed: make('books.reviewers.reviewed', Check, 'success'),
  changes_requested: make('books.reviewers.changesRequested', ArrowLeftRight, 'warning'),
}

export function reviewerDescriptor(state: string): SealDescriptor {
  return REVIEWER[state] ?? make(state, Eye, 'neutral')
}

/**
 * `signed_source` of the book's current (highest-numbered) version — the seals
 * nuance on it. List + detail payloads both carry enriched current versions.
 */
export function signedSourceOf(book: {
  versions?: { version_no: number; signed_source?: 'in_app' | 'scan' | null }[] | null
}): 'in_app' | 'scan' | null {
  const versions = book.versions ?? []
  if (versions.length === 0) return null
  const current = versions.reduce((a, b) => (b.version_no >= a.version_no ? b : a))
  return current.signed_source ?? null
}
