/**
 * Public hooks for the keyboard shortcuts system. Kept in a .ts file
 * (separate from the provider) so the .tsx file only exports a component.
 */

import { useContext, useEffect, useRef } from 'react'

import {
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
  const ctx = useContext(ShortcutsContext)
  // `register` is stable for the provider's lifetime; `ctx` itself changes
  // whenever the help sheet toggles and must not re-register anything.
  const register = ctx?.register
  const handlerRef = useRef(handler)
  useEffect(() => {
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
