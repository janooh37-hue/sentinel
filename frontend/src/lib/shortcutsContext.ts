/**
 * Shared types + context for the keyboard shortcuts system.
 *
 * Lives in a separate file so the provider .tsx file only exports a
 * component (react-refresh requirement).
 */

import { createContext } from 'react'

export type ShortcutAction =
  | 'focusSearch'   // Ctrl+K / ⌘K
  | 'newItem'       // Ctrl+N — primary "new" on the active page
  | 'showHelp'      // Ctrl+/ — open shortcuts help sheet
  // ── records group (bare keys; matched on KeyboardEvent.code) ──────────────
  | 'recordNext'        // J
  | 'recordPrev'        // K
  | 'recordOpen'        // Enter
  | 'recordOpenNewTab'  // Ctrl/⌘ + Enter
  | 'copyRef'           // C
  | 'focusDocument'     // F
  | 'signConfirm'       // S — only opens the confirm, never signs
  | 'toggleMark'        // M
  | 'zoomIn'            // = / numpad +
  | 'zoomOut'           // - / numpad −
  | 'zoomFit'           // 0 — Fit width
  | 'escape'            // Esc — one resolver per page
  | 'showHelpBare'      // ? — opens the help sheet

export interface ShortcutDescriptor {
  action: ShortcutAction
  combo: { ctrl?: true; key: string }
  labelKey: string
}

export const SHORTCUTS: readonly ShortcutDescriptor[] = [
  { action: 'focusSearch', combo: { ctrl: true, key: 'k' }, labelKey: 'shortcuts.focusSearch' },
  { action: 'newItem', combo: { ctrl: true, key: 'n' }, labelKey: 'shortcuts.newItem' },
  { action: 'showHelp', combo: { ctrl: true, key: '/' }, labelKey: 'shortcuts.showHelp' },
]

/** A row of the help sheet's Records section; `keys` are shown as separate key glyphs. */
export interface RecordShortcutDescriptor {
  action: ShortcutAction
  /** Glyphs in display order. `'Ctrl'` is rendered as ⌘ on Apple platforms. */
  keys: readonly string[]
  labelKey: string
}

export const RECORD_SHORTCUTS: readonly RecordShortcutDescriptor[] = [
  { action: 'recordNext', keys: ['J'], labelKey: 'shortcuts.records.next' },
  { action: 'recordPrev', keys: ['K'], labelKey: 'shortcuts.records.prev' },
  { action: 'recordOpen', keys: ['Enter'], labelKey: 'shortcuts.records.open' },
  { action: 'recordOpenNewTab', keys: ['Ctrl', 'Enter'], labelKey: 'shortcuts.records.openNewTab' },
  { action: 'copyRef', keys: ['C'], labelKey: 'shortcuts.records.copyRef' },
  { action: 'focusDocument', keys: ['F'], labelKey: 'shortcuts.records.focus' },
  { action: 'signConfirm', keys: ['S'], labelKey: 'shortcuts.records.sign' },
  { action: 'toggleMark', keys: ['M'], labelKey: 'shortcuts.records.mark' },
  { action: 'zoomIn', keys: ['+', '−', '0'], labelKey: 'shortcuts.records.zoom' },
  { action: 'escape', keys: ['Esc'], labelKey: 'shortcuts.records.back' },
  { action: 'showHelpBare', keys: ['?'], labelKey: 'shortcuts.records.help' },
]

/**
 * A shortcut handler. Return `false` to decline the key press: the dispatcher
 * then falls through to the next handler down the stack (and does not
 * `preventDefault`). Any other return value (including `undefined`) accepts it.
 */
export type Handler = () => boolean | void

/** Help-sheet state. Changes when the sheet toggles; action registration lives in `ShortcutRegisterContext`. */
export interface ShortcutsContextValue {
  helpOpen: boolean
  setHelpOpen: (open: boolean) => void
}

export const ShortcutsContext = createContext<ShortcutsContextValue | null>(null)

export type RegisterShortcut = (action: ShortcutAction, handler: Handler) => () => void

/** Stable identity for the lifetime of the provider, so `useShortcutAction` callers never re-render when help toggles. */
export const ShortcutRegisterContext = createContext<RegisterShortcut | null>(null)
