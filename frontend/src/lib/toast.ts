/**
 * The app's one notification API, backed by Sileo.
 *
 * Call sites keep the shape they had under Sonner (`toast.success(message,
 * { id, description, duration, action })`, `toast.dismiss(id)`, ...) so a
 * notice reads the same everywhere. Sileo itself differs in ways this module
 * absorbs:
 *
 * - Sileo keys every toast by `id` and falls back to ONE shared id, so two
 *   id-less calls would replace each other. Every call here gets a unique id
 *   unless the caller names one (same id = update in place, as in Sonner).
 *   `id` is read by Sileo's store but missing from its `SileoOptions` type.
 * - The pill is a single line about 284px wide; the description is revealed on
 *   hover or auto-expand. A message too wide for it is split after its first
 *   clause, or moved whole into the body under a localized state title, so
 *   nothing is clipped (lib/toastFit.ts).
 * - Sileo's action button does not close its toast, Sonner's did.
 * - Sileo's default title is the English state name, so a title is always set.
 *
 * On top of Sileo it adds: app glyphs in the badge, a countdown ring on an
 * action toast, a record reference (in the pill, or as a mono chip when there
 * is a body), server English shown as such under an Arabic title, and one
 * counted toast for a repeated notice.
 *
 * Do not import `sileo` anywhere else; `AppToaster` renders the host.
 */
import i18n from 'i18next'
import { createElement, Fragment, type ReactNode } from 'react'
import { sileo, type SileoOptions, type SileoState } from 'sileo'

import {
  ToastCountdown,
  ToastForeignText,
  ToastReference,
  ToastStateIcon,
} from '@/components/shell/toastParts'
import { publishAnnouncement } from '@/lib/toastAnnouncements'
import { fitsPill, splitClause } from '@/lib/toastFit'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  /** Same id updates the visible toast in place instead of stacking another. */
  id?: string | number
  description?: string
  /**
   * A record number or code (`GB-2026-0142`). Rides in the pill after the
   * message when that is the whole toast; otherwise a mono chip in the body.
   */
  reference?: string
  /** Milliseconds before the toast closes; `Infinity` keeps it until dismissed. */
  duration?: number
  action?: ToastAction
  /** Replaces the state's default glyph in the pill badge. */
  icon?: ReactNode
}

export interface ToastPromiseMessages<T> {
  loading: string
  success: string | ((data: T) => string)
  error: string | ((error: unknown) => string)
}

/** Sonner's historical default, kept so existing call sites keep their timing. */
export const TOAST_DEFAULT_DURATION_MS = 4000

type ToastKind = 'neutral' | 'success' | 'error' | 'warning' | 'info' | 'loading'

// Sileo's store honours `id`; its published type does not list it.
type SileoOptionsWithId = SileoOptions & { id: string }

let sequence = 0

function nextId(): string {
  // Skip any id a caller already holds, so a generated id never aliases one.
  do sequence += 1
  while (generations.has(`toast-${sequence}`))
  return `toast-${sequence}`
}

function stateOf(kind: ToastKind, hasAction: boolean): SileoState {
  if (kind === 'neutral') return hasAction ? 'action' : 'info'
  return kind
}

function stateLabel(state: SileoState): string {
  return i18n.t(`common.toastState.${state}`)
}

function resolveDuration(kind: ToastKind, duration: number | undefined): number | null {
  if (kind === 'loading') return null
  if (duration === undefined) return TOAST_DEFAULT_DURATION_MS
  return Number.isFinite(duration) ? duration : null
}

const LATIN = /[A-Za-z]/
const ARABIC = /[\u0600-\u06FF]/

/**
 * Text with no Arabic in an Arabic UI: the server's English error detail, a
 * file name, an HTTP status. It is not a sentence the pill can lead with.
 */
function isForeign(message: string): boolean {
  return i18n.language.startsWith('ar') && LATIN.test(message) && !ARABIC.test(message)
}

/** The pill title, and the body lines under it, for one message. */
function compose(state: SileoState, message: string): { title: string; lead: ReactNode | undefined } {
  // Sileo never opens a loading toast's body, so its message must stay in the pill.
  if (state !== 'loading' && isForeign(message)) {
    const title = state === 'error' ? i18n.t('common.toastServerError') : stateLabel(state)
    return { title, lead: createElement(ToastForeignText, { text: message }) }
  }
  if (fitsPill(message)) return { title: message, lead: undefined }
  const clause = splitClause(message)
  if (clause && fitsPill(clause.head)) return { title: clause.head, lead: clause.rest }
  return { title: stateLabel(state), lead: message }
}

/**
 * The body: plain text stays a string (Sileo's `white-space: pre-line` keeps
 * the line breaks); a chip or foreign text makes it a fragment of block rows.
 */
function bodyOf(lead: ReactNode | undefined, description: string | undefined, reference: string | undefined): ReactNode {
  const text = [lead, description].filter((part) => part !== undefined && part !== '')
  if (reference === undefined && text.every((part) => typeof part === 'string')) {
    return text.length > 0 ? text.join('\n') : undefined
  }
  return createElement(
    Fragment,
    null,
    ...text.map((part, index) =>
      typeof part === 'string' ? createElement('span', { key: index, className: 'toast-text' }, part) : part,
    ),
    reference === undefined ? null : createElement(ToastReference, { key: 'ref', value: reference }),
  )
}

function announce(state: SileoState, message: string, opts: ToastOptions): void {
  const text = [`${stateLabel(state)}: ${message}`, opts.description, opts.reference].filter(Boolean).join('. ')
  publishAnnouncement(state === 'error' ? 'assertive' : 'polite', text)
}

function buildOptions(
  kind: ToastKind,
  id: string,
  message: string,
  opts: ToastOptions,
  count = 1,
): SileoOptionsWithId {
  const state = stateOf(kind, opts.action !== undefined)
  const composed = compose(state, message)
  const action = opts.action
  // A reference rides in the pill (isolated, so its digits and dashes keep their
  // order in Arabic) when that is the whole toast; opening a body just for it
  // would balloon every "Saved"/"Copied" notice. With a body, it is a chip there.
  const inline =
    opts.reference !== undefined && composed.lead === undefined && !opts.description && !action
      ? `${composed.title} · \u2068${opts.reference}\u2069`
      : undefined
  const refInPill = inline !== undefined && fitsPill(inline)
  const title = refInPill ? inline : composed.title
  const description = bodyOf(composed.lead, opts.description, refInPill ? undefined : opts.reference)
  const duration = resolveDuration(kind, opts.duration)
  const glyph = opts.icon ?? createElement(ToastStateIcon, { state, size: action && duration !== null ? 11 : 15 })
  return {
    id,
    type: state,
    // A repeated notice counts up in place instead of stacking (see `repeatOf`).
    title: count > 1 ? `${title} \u00d7${count}` : title,
    description,
    icon: action && duration !== null ? createElement(ToastCountdown, { durationMs: duration, children: glyph }) : glyph,
    duration,
    // Sileo collapses the body 2s before closing by default; a long message or
    // an Undo needs the whole window, so the body stays open until the toast goes.
    autopilot: duration === null ? undefined : { collapse: duration },
    // A body that holds only the action drops its text gap (AppToaster.css).
    styles: action && !description ? { description: 'toast-action-only' } : undefined,
    button: action
      ? {
          title: action.label,
          onClick: () => {
            try {
              action.onClick()
            } finally {
              dismiss(id)
            }
          },
        }
      : undefined,
  }
}

/**
 * Sileo's `dismiss(id)` schedules "remove every item with this id" 600 ms later,
 * and a toast raised with the same id in that window is deleted by that stale
 * timer. A caller-chosen id therefore maps to a generation-suffixed Sileo id: it
 * is reused while that toast is live (update in place) and replaced by a fresh
 * generation once it is closing or gone. Id-less toasts are unique already.
 */
interface Generation {
  internal: string
  /** True once the host has seen the toast live in the DOM. */
  seen: boolean
}

const generations = new Map<string, Generation>()
let generationCounter = 0

function internalIdFor(callerId: string): string {
  const existing = generations.get(callerId)
  if (existing) return existing.internal
  generationCounter += 1
  const internal = `${callerId}#${generationCounter}`
  generations.set(callerId, { internal, seen: false })
  return internal
}

/** Forgets the generation a caller id or Sileo id belongs to, so the next raise starts a fresh one. */
function release(id: string): string {
  const direct = generations.get(id)
  if (direct) {
    generations.delete(id)
    return direct.internal
  }
  for (const [callerId, generation] of generations) {
    if (generation.internal === id) generations.delete(callerId)
  }
  return id
}

/**
 * Called by the host with the toasts Sileo currently renders. A generation that
 * is closing, or that vanished after being seen (an auto-close, which only Sileo
 * itself performs), is dropped so a later raise of the same id is a new toast.
 */
export function reconcileToastGenerations(rendered: ReadonlyArray<{ id: string; exiting: boolean }>): void {
  for (const [callerId, generation] of generations) {
    const match = rendered.find((item) => item.id === generation.internal)
    if (match && !match.exiting) generation.seen = true
    else if (match || generation.seen) generations.delete(callerId)
  }
}

/** Live id-less notices by content, so the same one raised again counts up in place. */
const repeats = new Map<string, { callerId: string; count: number }>()

/**
 * The same id-less notice raised while it is still on screen (a dropped network
 * fails every open query at once) updates that toast with a count instead of
 * stacking copies. Toasts with an id or an action are never merged: an id is
 * the caller's own identity, and two Undos undo different things.
 */
function repeatOf(kind: ToastKind, message: string, opts: ToastOptions): { callerId: string; count: number } | null {
  if (opts.id !== undefined || opts.action !== undefined || kind === 'loading') return null
  for (const [key, entry] of repeats) {
    if (!generations.has(entry.callerId)) repeats.delete(key)
  }
  const key = [kind, message, opts.description ?? '', opts.reference ?? ''].join('\u0000')
  const previous = repeats.get(key)
  const entry = previous ? { callerId: previous.callerId, count: previous.count + 1 } : { callerId: nextId(), count: 1 }
  repeats.set(key, entry)
  return entry
}

function show(kind: ToastKind, message: string, opts: ToastOptions = {}): string {
  const repeat = repeatOf(kind, message, opts)
  const callerId = repeat?.callerId ?? (opts.id !== undefined ? String(opts.id) : nextId())
  const internal = internalIdFor(callerId)
  announce(stateOf(kind, opts.action !== undefined), message, opts)
  sileo.show(buildOptions(kind, internal, message, opts, repeat?.count))
  return callerId
}

function dismiss(id?: string | number): void {
  if (id === undefined) {
    generations.clear()
    sileo.clear()
  } else {
    sileo.dismiss(release(String(id)))
  }
}

function promise<T>(source: Promise<T> | (() => Promise<T>), messages: ToastPromiseMessages<T>): Promise<T> {
  const id = internalIdFor(nextId())
  const resolveOf = <A>(message: string | ((arg: A) => string), arg: A): string =>
    typeof message === 'function' ? message(arg) : message
  announce('loading', messages.loading, {})
  return sileo.promise(source, {
    loading: buildOptions('loading', id, messages.loading, {}),
    success: (data) => {
      const message = resolveOf(messages.success, data)
      announce('success', message, {})
      return buildOptions('success', id, message, {})
    },
    error: (error) => {
      const message = resolveOf(messages.error, error)
      announce('error', message, {})
      return buildOptions('error', id, message, {})
    },
  })
}

export const toast = Object.assign(
  (message: string, opts?: ToastOptions): string => show('neutral', message, opts),
  {
    success: (message: string, opts?: ToastOptions): string => show('success', message, opts),
    error: (message: string, opts?: ToastOptions): string => show('error', message, opts),
    warning: (message: string, opts?: ToastOptions): string => show('warning', message, opts),
    info: (message: string, opts?: ToastOptions): string => show('info', message, opts),
    loading: (message: string, opts?: Pick<ToastOptions, 'id' | 'description' | 'reference'>): string =>
      show('loading', message, opts),
    promise,
    dismiss,
  },
)
