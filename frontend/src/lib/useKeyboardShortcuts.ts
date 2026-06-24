/**
 * Public hooks for the keyboard shortcuts system. Kept in a .ts file
 * (separate from the provider) so the .tsx file only exports a component.
 */

import { useContext, useEffect } from 'react'

import {
  ShortcutsContext,
  type Handler,
  type ShortcutAction,
  type ShortcutsContextValue,
} from './shortcutsContext'

/**
 * Register a handler for a named shortcut action while the calling component
 * is mounted. Re-registers when `handler` changes.
 */
export function useShortcutAction(action: ShortcutAction, handler: Handler | null): void {
  const ctx = useContext(ShortcutsContext)
  useEffect(() => {
    if (!ctx || !handler) return
    return ctx.register(action, handler)
  }, [ctx, action, handler])
}

export function useShortcutsContext(): ShortcutsContextValue {
  const ctx = useContext(ShortcutsContext)
  if (!ctx) {
    throw new Error('useShortcutsContext must be used inside KeyboardShortcutsProvider')
  }
  return ctx
}
