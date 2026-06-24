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

export type Handler = () => void

export interface ShortcutsContextValue {
  register: (action: ShortcutAction, handler: Handler) => () => void
  helpOpen: boolean
  setHelpOpen: (open: boolean) => void
}

export const ShortcutsContext = createContext<ShortcutsContextValue | null>(null)
