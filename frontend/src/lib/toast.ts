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
 * - The pill is a single line of ~36 characters; the description is revealed on
 *   hover or auto-expand. Longer messages move into the description under a
 *   localized state title, so nothing is clipped.
 * - Sileo's action button does not close its toast, Sonner's did.
 * - Sileo's default title is the English state name, so a title is always set.
 *
 * Do not import `sileo` anywhere else; `AppToaster` renders the host.
 */
import i18n from 'i18next'
import type { ReactNode } from 'react'
import { sileo, type SileoOptions, type SileoState } from 'sileo'

import { publishAnnouncement } from '@/lib/toastAnnouncements'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  /** Same id updates the visible toast in place instead of stacking another. */
  id?: string | number
  description?: string
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

/** Sileo's own default, and long enough to read a one-line error. */
export const TOAST_DEFAULT_DURATION_MS = 6000

/** Longest message that still fits the collapsed pill without clipping. */
export const TOAST_TITLE_MAX_CHARS = 36

type ToastKind = 'neutral' | 'success' | 'error' | 'warning' | 'info' | 'loading'

// Sileo's store honours `id`; its published type does not list it.
type SileoOptionsWithId = SileoOptions & { id: string }

let sequence = 0

function nextId(): string {
  sequence += 1
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

function compose(
  state: SileoState,
  message: string,
  description: string | undefined,
): { title: string; description: string | undefined } {
  if (message.length <= TOAST_TITLE_MAX_CHARS) return { title: message, description }
  return {
    title: stateLabel(state),
    description: description ? `${message}\n${description}` : message,
  }
}

function announce(state: SileoState, message: string, description: string | undefined): void {
  const text = [`${stateLabel(state)}: ${message}`, description].filter(Boolean).join('. ')
  publishAnnouncement(state === 'error' ? 'assertive' : 'polite', text)
}

function buildOptions(kind: ToastKind, id: string, message: string, opts: ToastOptions): SileoOptionsWithId {
  const state = stateOf(kind, opts.action !== undefined)
  const { title, description } = compose(state, message, opts.description)
  const action = opts.action
  const duration = resolveDuration(kind, opts.duration)
  return {
    id,
    type: state,
    title,
    description,
    icon: opts.icon,
    duration,
    // Sileo collapses the body 2s before closing by default; a long message or
    // an Undo needs the whole window, so the body stays open until the toast goes.
    autopilot: duration === null ? undefined : { collapse: duration },
    button: action
      ? {
          title: action.label,
          onClick: () => {
            try {
              action.onClick()
            } finally {
              sileo.dismiss(id)
            }
          },
        }
      : undefined,
  }
}

function show(kind: ToastKind, message: string, opts: ToastOptions = {}): string {
  const id = opts.id !== undefined ? String(opts.id) : nextId()
  announce(stateOf(kind, opts.action !== undefined), message, opts.description)
  return sileo.show(buildOptions(kind, id, message, opts))
}

function dismiss(id?: string | number): void {
  if (id === undefined) sileo.clear()
  else sileo.dismiss(String(id))
}

function promise<T>(source: Promise<T> | (() => Promise<T>), messages: ToastPromiseMessages<T>): Promise<T> {
  const id = nextId()
  const resolveOf = <A>(message: string | ((arg: A) => string), arg: A): string =>
    typeof message === 'function' ? message(arg) : message
  announce('loading', messages.loading, undefined)
  return sileo.promise(source, {
    loading: buildOptions('loading', id, messages.loading, {}),
    success: (data) => {
      const message = resolveOf(messages.success, data)
      announce('success', message, undefined)
      return buildOptions('success', id, message, {})
    },
    error: (error) => {
      const message = resolveOf(messages.error, error)
      announce('error', message, undefined)
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
    loading: (message: string, opts?: Pick<ToastOptions, 'id' | 'description'>): string =>
      show('loading', message, opts),
    promise,
    dismiss,
  },
)
