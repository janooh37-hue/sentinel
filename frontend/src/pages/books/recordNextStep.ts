/**
 * Record "next step" model — one pure answer to "what is this record waiting
 * for, and what can I do about it?", shared by the record page header/dock and
 * the Records pane so both agree (prototype `nextStep`, clarity P3).
 *
 * Output: a status sentence (`books.status.<key>` + vars), an optional quote
 * (the returner's note), AT MOST ONE primary action, labelled secondary
 * actions and the overflow (Tools / More) list. Actions the caller's
 * capabilities rule out are omitted; actions that exist but cannot run now stay
 * in place with a `disabled` reason key (`books.reason.*`).
 *
 * Pure: no React, no i18n. Consumers render `t(`books.status.${status.key}`,
 * status.vars)` and map each `ActionId` to its handler.
 */
import type { BookApprovalStepRead, BookRead, BookVersionRead } from '@/lib/api'
import {
  canFileSignedCopy,
  canSendForApproval,
  type InmateReporterAction,
} from '@/components/books/book-detail-drawer-utils'
import { approverStep } from '@/components/books/reviewers'
import { parseUtcMs } from '@/lib/time'

import { deleteBlockReason, deleteReasonKey } from './recordDelete'

export type ActionId =
  | 'sendForApproval'
  | 'continueEditing'
  | 'print'
  | 'email'
  | 'addToPdf'
  | 'deleteDraft'
  | 'deleteRecord'
  | 'finishEditing'
  | 'discardDraft'
  | 'sign'
  | 'returnForChanges'
  | 'reject'
  | 'markUp'
  | 'reroute'
  | 'scanSigned'
  | 'approveReviewed'
  | 'requestChanges'
  | 'downloadSigned'
  | 'adjustSignature'
  | 'replaceSigned'
  | 'removeSigned'
  | 'changeState'
  | 'revise'

/** Suffix under `books.status.` — one per row of the state table. */
export type StatusKey =
  | 'draft'
  | 'noDoc'
  | 'wordActive'
  | 'pendingMine'
  | 'pendingOther'
  | 'reviewMine'
  | 'awaitingScan'
  | 'approved'
  | 'returned'
  | 'rejected'
  | 'voided'
  | 'pendingOtherNoName'
  | 'approvedNoName'
  | 'returnedNoName'
  | 'rejectedNoName'

/** Full i18n key of a disabled-action explanation. */
export type ReasonKey =
  | 'books.reason.inFlight'
  | 'books.reason.wordSession'
  | 'books.reason.reviseNoTemplate'
  | 'books.reason.reviseNoPermission'
  | 'books.reason.reviseNotCurrent'
  | 'books.reason.reviseReporterLocked'
  | 'books.reason.emailNoDoc'

export type ReviseBlockReason = 'noTemplate' | 'noPermission' | 'notCurrent' | 'reporterLocked'

export interface NextStepContext {
  /** The user's capability check (`useCapabilities().has`). */
  has: (cap: string) => boolean
  /** `has('books.edit')`. */
  canEdit: boolean
  /** `has('documents.generate')` — Revise regenerates via POST /documents/generate. */
  canGenerate: boolean
  /** Full access AND the live revision (BRP `canMutateCurrent`). */
  canMutateCurrent: boolean
  isInmateReporter: boolean
  /** `inmateReporterActionFor(book, user.id)`; `'read-only'` for everyone else. */
  inmateAction: InmateReporterAction
  /** The user holds the pending approver step of the live revision (BRP `isAssignee`). */
  isAssignee: boolean
  /** The user holds a pending advisory-reviewer step of the live revision. */
  isReviewer: boolean
  /** A document (generated or imported PDF) exists to print / attach / email. */
  hasDocument: boolean
  /** BRP `canManageIncludedPapers` — gates "Add to PDF". */
  canManageIncludedPapers: boolean
  /** Epoch ms; the `{{ago}}` var is relative to it. */
  now: number
  /** BCP-47 locale for the `{{ago}}` var. */
  locale: string
}

export type ReviseContext = Pick<
  NextStepContext,
  'canGenerate' | 'canMutateCurrent' | 'isInmateReporter' | 'inmateAction'
>

export interface NextStep {
  status: { key: StatusKey; vars: Record<string, string> }
  /** The returner's note for returned / rejected records. */
  quote?: string
  primary?: ActionId
  secondary: ActionId[]
  overflow: ActionId[]
  /** The primary opens the sign-and-approve flow (BRP `action === 'decide'`). */
  decide?: boolean
  disabled?: Partial<Record<ActionId, ReasonKey>>
}

/** The revision BRP treats as "current": the server-selected one, else the live (last) one. */
function currentVersionOf(book: BookRead): BookVersionRead | undefined {
  const versions = book.versions ?? []
  const live = versions.length ? versions[versions.length - 1] : undefined
  return (
    (book.selected_version_id != null
      ? versions.find((v) => v.id === book.selected_version_id)
      : undefined) ?? live
  )
}

/**
 * Why Revise cannot run, or `null` when it can. Splits BRP's `canRevise`:
 * no form template / no generate permission / not the live revision / an
 * inmate reporter whose record has not been returned to them.
 */
export function reviseBlockReason(book: BookRead, ctx: ReviseContext): ReviseBlockReason | null {
  const current = currentVersionOf(book)
  if (!current?.template_id || !current.has_fields) return 'noTemplate'
  if (!ctx.canGenerate) return 'noPermission'
  if (!ctx.canMutateCurrent) return 'notCurrent'
  if (ctx.isInmateReporter && ctx.inmateAction !== 'correct-resubmit') return 'reporterLocked'
  return null
}

const REVISE_REASON_KEYS: Record<ReviseBlockReason, ReasonKey> = {
  noTemplate: 'books.reason.reviseNoTemplate',
  noPermission: 'books.reason.reviseNoPermission',
  notCurrent: 'books.reason.reviseNotCurrent',
  reporterLocked: 'books.reason.reviseReporterLocked',
}

export function reviseReasonKey(reason: ReviseBlockReason | null): ReasonKey | null {
  return reason ? REVISE_REASON_KEYS[reason] : null
}

/** "2 days ago" / "3 hours ago" via Intl; older than 30 days falls back to a short date. */
export function relativeAgo(iso: string | null | undefined, now: number, locale: string): string {
  if (!iso) return ''
  const then = parseUtcMs(iso)
  if (Number.isNaN(then)) return ''
  const diff = then - now
  const abs = Math.abs(diff)
  const min = 60_000
  const hr = 60 * min
  const day = 24 * hr
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (abs < min) return rtf.format(0, 'minute')
  if (abs < hr) return rtf.format(Math.round(diff / min), 'minute')
  if (abs < day) return rtf.format(Math.round(diff / hr), 'hour')
  if (abs < 30 * day) return rtf.format(Math.round(diff / day), 'day')
  return new Date(then).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
}

function decisionStep(
  steps: BookApprovalStepRead[],
  states: string[],
): BookApprovalStepRead | undefined {
  const decided = steps.filter((s) => states.includes(s.state))
  const approver = decided.find((s) => s.kind !== 'reviewer')
  return approver ?? decided[0]
}

function step(
  status: NextStep['status'],
  parts: Partial<Omit<NextStep, 'status' | 'secondary' | 'overflow'>> & {
    secondary?: ActionId[]
    overflow?: ActionId[]
  },
): NextStep {
  const { secondary = [], overflow = [], ...rest } = parts
  // Never render a dangling "by ·": no resolvable name → the nameless sentence.
  const needsName = status.key === 'pendingOther' || status.key === 'approved' || status.key === 'returned' || status.key === 'rejected'
  const nameless: NextStep['status'] =
    needsName && !status.vars.name ? { ...status, key: `${status.key}NoName` as StatusKey } : status
  const out: NextStep = { status: nameless, secondary, overflow, ...rest }
  if (out.disabled && Object.keys(out.disabled).length === 0) delete out.disabled
  return out
}

/** Keeps the truthy entries of an `[id, include]` list, in order. */
function pick(entries: Array<[ActionId, boolean]>): ActionId[] {
  return entries.filter(([, include]) => include).map(([id]) => id)
}

/**
 * The next-step model. Delete is appended to every state's overflow whenever
 * the viewer may see it (and Change state under the admin capability), disabled with its reason (in flight, Word session),
 * so every surface (pane, Tools menu, More sheet) agrees from one place.
 */
export function recordNextStep(book: BookRead, ctx: NextStepContext): NextStep {
  const built = buildNextStep(book, ctx)
  // Change state (admin) is a Tools/More entry in every state, not only approved.
  const out =
    !ctx.isInmateReporter &&
    ctx.canMutateCurrent &&
    ctx.has('books.override_state') &&
    !built.overflow.includes('changeState')
      ? { ...built, overflow: [...built.overflow, 'changeState' as const] }
      : built
  const reason = deleteBlockReason(book, { has: ctx.has, isInmateReporter: ctx.isInmateReporter })
  if (reason === 'noCapability' || reason === 'restricted') return out
  const id: ActionId = book.approval_state === 'none' ? 'deleteDraft' : 'deleteRecord'
  if (out.overflow.includes(id)) return out
  const key = deleteReasonKey(reason)
  return {
    ...out,
    overflow: [...out.overflow, id],
    ...(key ? { disabled: { ...out.disabled, [id]: key } } : {}),
  }
}

function buildNextStep(book: BookRead, ctx: NextStepContext): NextStep {
  const state = book.approval_state
  const current = currentVersionOf(book)
  const steps: BookApprovalStepRead[] = current?.approval_steps ?? book.approval_steps ?? []
  const wordActive = book.edit_session?.state === 'active'
  const inmate = ctx.isInmateReporter
  const isInmateReport =
    inmate && book.ref_number.startsWith('REPORT-') && ctx.inmateAction !== 'read-only'
  const canApprove = ctx.has('books.approve')
  const canSubmitBook = ctx.has('books.submit')
  const canScan = ctx.has('documents.scan')

  // Gates mirrored from BookRecordPage so the model and the page agree.
  const canWord = ctx.canMutateCurrent && (!inmate || isInmateReport)
  const canSend =
    ctx.canMutateCurrent &&
    (isInmateReport
      ? state === 'none' && !wordActive
      : inmate
        ? ctx.inmateAction === 'edit-submit'
        : canSendForApproval(state, { canSubmitBook }))
  const canReroute = !inmate && ctx.canMutateCurrent && canSendForApproval('pending', { canSubmitBook })
  const canContinue =
    ctx.canMutateCurrent && (inmate ? ctx.inmateAction === 'edit-submit' : ctx.canEdit)
  const canFileSigned =
    !inmate && ctx.canMutateCurrent && canFileSignedCopy(state, { canEdit: ctx.canEdit, canScan })
  const hasSignedCopy = state === 'approved' && Boolean(current?.signed_pdf_url)
  const canManageSignedPaper = hasSignedCopy && ctx.canEdit && ctx.canMutateCurrent && !inmate
  const canEmail = !inmate

  const emailDisabled: Partial<Record<ActionId, ReasonKey>> =
    canEmail && !ctx.hasDocument ? { email: 'books.reason.emailNoDoc' } : {}

  const deleteReason = deleteBlockReason(book, { has: ctx.has, isInmateReporter: inmate })
  const deleteVisible = deleteReason !== 'noCapability' && deleteReason !== 'restricted'
  const deleteDisabledKey = deleteReasonKey(deleteReason)
  const deleteDisabled = (id: ActionId): Partial<Record<ActionId, ReasonKey>> =>
    deleteDisabledKey ? { [id]: deleteDisabledKey } : {}

  const name = (s: BookApprovalStepRead | undefined): string =>
    s?.assignee_name ?? book.doc_manager_name ?? ''

  // A voided record (discarded draft) is read-only; its ref stays in the register.
  if (book.voided_at) {
    return step({ key: 'voided', vars: {} }, { overflow: ['print'] })
  }

  // An advisory reviewer's pending step stays actionable whatever the aggregate
  // state (late feedback) — unless the same user is deciding the signer step.
  const deciding = state === 'pending' && ctx.isAssignee && canApprove
  if (ctx.isReviewer && !deciding && state !== 'none') {
    return step(
      { key: 'reviewMine', vars: {} },
      { primary: 'approveReviewed', secondary: ['requestChanges'], overflow: ['print'] },
    )
  }

  switch (state) {
    case 'none': {
      if (wordActive) {
        return step(
          { key: 'wordActive', vars: { name: book.edit_session?.user_name ?? '' } },
          canWord
            ? { primary: 'finishEditing', secondary: ['discardDraft'], overflow: ['print'] }
            : { overflow: ['print'] },
        )
      }
      if (!ctx.hasDocument) {
        return step(
          { key: 'noDoc', vars: {} },
          {
            primary: canContinue ? 'continueEditing' : undefined,
            overflow: pick([['deleteDraft', deleteVisible]]),
            disabled: deleteDisabled('deleteDraft'),
          },
        )
      }
      return step(
        { key: 'draft', vars: {} },
        {
          primary: canSend ? 'sendForApproval' : canContinue ? 'continueEditing' : undefined,
          secondary: pick([['continueEditing', canSend && canContinue]]),
          overflow: pick([
            ['print', true],
            ['email', canEmail],
            ['addToPdf', ctx.canManageIncludedPapers],
            ['scanSigned', canFileSigned],
            ['deleteDraft', deleteVisible],
          ]),
          disabled: { ...emailDisabled, ...deleteDisabled('deleteDraft') },
        },
      )
    }

    case 'pending': {
      if (deciding) {
        return step(
          { key: 'pendingMine', vars: {} },
          {
            primary: 'sign',
            decide: true,
            secondary: ['returnForChanges', 'reject'],
            overflow: pick([
              ['markUp', true],
              ['reroute', canReroute],
              ['scanSigned', canFileSigned],
              ['print', true],
            ]),
          },
        )
      }
      return step(
        {
          key: 'pendingOther',
          vars: {
            name: name(approverStep(steps)),
            ago: relativeAgo(book.submitted_at, ctx.now, ctx.locale),
          },
        },
        {
          secondary: pick([['reroute', canReroute]]),
          overflow: pick([
            ['print', true],
            ['email', canEmail],
            ['scanSigned', canFileSigned],
          ]),
          disabled: emailDisabled,
        },
      )
    }

    case 'awaiting_scan':
      return step(
        { key: 'awaitingScan', vars: {} },
        {
          primary: canFileSigned ? 'scanSigned' : undefined,
          overflow: pick([
            ['print', true],
            ['email', canEmail],
          ]),
          disabled: emailDisabled,
        },
      )

    case 'approved': {
      const signer = decisionStep(steps, ['approved'])
      return step(
        {
          key: 'approved',
          vars: { name: name(signer), date: signer?.decided_at?.slice(0, 10) ?? '' },
        },
        {
          primary: hasSignedCopy ? 'downloadSigned' : undefined,
          overflow: pick([
            ['email', canEmail],
            ['print', true],
            ['adjustSignature', !inmate && ctx.canMutateCurrent && current?.document_id != null],
            ['replaceSigned', canManageSignedPaper],
            ['removeSigned', canManageSignedPaper],
            ['changeState', !inmate && ctx.canMutateCurrent && ctx.has('books.override_state')],
          ]),
          disabled: emailDisabled,
        },
      )
    }

    case 'returned':
    case 'rejected': {
      const decider = decisionStep(steps, [state])
      const reviseKey = reviseReasonKey(reviseBlockReason(book, ctx))
      return step(
        { key: state, vars: { name: name(decider) } },
        {
          quote: decider?.note?.trim() ? decider.note : undefined,
          primary: inmate || ctx.canEdit ? 'revise' : undefined,
          overflow: pick([
            ['print', true],
            ['deleteRecord', deleteVisible],
          ]),
          disabled: {
            ...(reviseKey && (inmate || ctx.canEdit) ? { revise: reviseKey } : {}),
            ...deleteDisabled('deleteRecord'),
          },
        },
      )
    }

    default:
      return step({ key: 'draft', vars: {} }, { overflow: ['print'] })
  }
}
