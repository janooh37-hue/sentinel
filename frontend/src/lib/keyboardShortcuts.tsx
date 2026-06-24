/**
 * Keyboard shortcuts — provider component.
 *
 * Components register a handler for a named action (e.g. "focusSearch",
 * "newItem") via `useShortcutAction` from `./useKeyboardShortcuts`. The
 * provider listens once on `window` keydown and routes matching combos to
 * the most recently registered handler for that action.
 *
 * Why a registry instead of per-component listeners:
 *   * Per-page actions ("Ctrl+N → New …") need a single handler whose
 *     identity changes with `currentPage`. A registry decouples key→action
 *     from action→handler.
 *   * The help sheet (Ctrl+/) can introspect the registered actions to list
 *     what is currently bound.
 *
 * Modifier matching: `ctrlKey || metaKey` so both Windows and Mac work.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  ShortcutsContext,
  type Handler,
  type ShortcutAction,
  type ShortcutsContextValue,
} from './shortcutsContext'

export function KeyboardShortcutsProvider({
  children,
}: {
  children: ReactNode
}): React.JSX.Element {
  // Map of action → list of handlers. Most-recently-registered wins; when
  // a handler unmounts the previous one is restored.
  const handlersRef = useRef<Map<ShortcutAction, Handler[]>>(new Map())
  const [helpOpen, setHelpOpen] = useState(false)

  const register = useCallback((action: ShortcutAction, handler: Handler) => {
    const map = handlersRef.current
    const stack = map.get(action) ?? []
    stack.push(handler)
    map.set(action, stack)
    return () => {
      const cur = handlersRef.current.get(action)
      if (!cur) return
      const idx = cur.lastIndexOf(handler)
      if (idx >= 0) cur.splice(idx, 1)
      if (cur.length === 0) handlersRef.current.delete(action)
    }
  }, [])

  const dispatch = useCallback((action: ShortcutAction): boolean => {
    const stack = handlersRef.current.get(action)
    if (!stack || stack.length === 0) return false
    const handler = stack[stack.length - 1]
    handler()
    return true
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()

      // Ctrl+K — always allowed (including from inputs); navigation shortcut.
      if (key === 'k') {
        if (dispatch('focusSearch')) e.preventDefault()
        return
      }
      // Ctrl+/ — help sheet
      if (key === '/') {
        setHelpOpen((prev) => !prev)
        e.preventDefault()
        return
      }
      // Ctrl+N — block when typing in a form control so we don't hijack
      // a browser shortcut the user has muscle memory for.
      if (key === 'n') {
        const target = e.target as HTMLElement | null
        if (target && isEditableTarget(target)) return
        if (dispatch('newItem')) e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dispatch])

  const value = useMemo<ShortcutsContextValue>(
    () => ({ register, helpOpen, setHelpOpen }),
    [register, helpOpen],
  )

  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>
}

function isEditableTarget(el: HTMLElement): boolean {
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return false
}
