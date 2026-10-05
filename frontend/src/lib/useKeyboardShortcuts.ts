/**
 * Public hooks for the keyboard shortcuts system. Kept in a .ts file
 * (separate from the provider) so the .tsx file only exports a component.
 */

import { useContext, useEffect, useLayoutEffect, useRef } from 'react'

import {
  ShortcutRegisterContext,
  ShortcutsContext,
  type Handler,
  type ShortcutAction,
  type ShortcutsContextValue,
} from './shortcutsContext'

/**
 * Register a handler for a named shortcut action while the calling component
 * is mounted.
 *
 * The latest `handler` is kept in a ref and a stable trampoline is registered
 * once per `(register, action)`, so re-renders (inline closures) never
 * reorder the handler stack. A `null` handler declines (falls through to the
 * next handler), exactly like returning `false`.
 */
export function useShortcutAction(action: ShortcutAction, handler: Handler | null): void {
  // Stable for the provider's lifetime and independent of the help-sheet
  // state, so this hook never re-renders its caller when help toggles.
  const register = useContext(ShortcutRegisterContext)
  const handlerRef = useRef(handler)
  // Layout effect: the ref must hold this render's handler before any key
  // event can be dispatched after commit.
  useLayoutEffect(() => {
    handlerRef.current = handler
  })
  useEffect(() => {
    if (!register) return
    return register(action, () => (handlerRef.current ? handlerRef.current() : false))
  }, [register, action])
}

export function useShortcutsContext(): ShortcutsContextValue {
  const ctx = useContext(ShortcutsContext)
  if (!ctx) {
    throw new Error('useShortcutsContext must be used inside KeyboardShortcutsProvider')
  }
  return ctx
}
