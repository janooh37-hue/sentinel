/**
 * Keyboard shortcuts — provider component.
 *
 * Components register a handler for a named action (e.g. "focusSearch",
 * "recordNext") via `useShortcutAction` from `./useKeyboardShortcuts`. The
 * provider listens once on `window` keydown and routes matching keys to the
 * registered handlers for that action.
 *
 * Why a registry instead of per-component listeners:
 *   * Per-page actions ("Ctrl+N → New …") need a single handler whose
 *     identity changes with `currentPage`. A registry decouples key→action
 *     from action→handler.
 *   * The help sheet (Ctrl+/) can introspect the registered actions to list
 *     what is currently bound.
 *
 * Dispatch: handlers form a stack per action (most recently registered on
 * top). `dispatch` walks it top → bottom and stops at the first handler that
 * does not return `false`; only then is the key's default prevented. A handler
 * that cannot act right now returns `false` to let a lower one try.
 *
 * Two key layers:
 *   * Modifier layer — Ctrl/⌘ + K, /, N (matched on `e.key`, `ctrlKey || metaKey`
 *     so Windows and Mac both work) and Ctrl/⌘ + Enter.
 *   * Bare-key layer — J K C F S M = - 0 Enter ? Esc, matched on
 *     `KeyboardEvent.code` so they work on any keyboard layout (Arabic included).
 *     They never fire with Ctrl/Meta/Alt held, during IME composition, from an
 *     editable target, or while an overlay is open.
 *
 * The listener runs in the capture phase on `window`: it must observe Esc
 * *before* Radix's own document-level Esc handler closes an overlay, otherwise
 * the same key press that dismissed a dialog would also run the page's Esc
 * resolver (e.g. navigate Back).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  ShortcutsContext,
  type Handler,
  type ShortcutAction,
  type ShortcutsContextValue,
} from './shortcutsContext'

/** `KeyboardEvent.code` → action for the bare-key layer. */
const BARE_KEY_ACTIONS: Readonly<Record<string, ShortcutAction>> = {
  KeyJ: 'recordNext',
  KeyK: 'recordPrev',
  KeyC: 'copyRef',
  KeyF: 'focusDocument',
  KeyS: 'signConfirm',
  KeyM: 'toggleMark',
  Equal: 'zoomIn',
  NumpadAdd: 'zoomIn',
  Minus: 'zoomOut',
  NumpadSubtract: 'zoomOut',
  Digit0: 'zoomFit',
  Numpad0: 'zoomFit',
  Enter: 'recordOpen',
}

/** Held keys must not re-fire these (one press = one effect). */
const NO_REPEAT: Readonly<Partial<Record<ShortcutAction, true>>> = {
  recordOpen: true,
  copyRef: true,
  focusDocument: true,
  signConfirm: true,
  toggleMark: true,
  zoomFit: true,
}

const OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
  '[aria-modal="true"]',
].join(',')

export function KeyboardShortcutsProvider({
  children,
}: {
  children: ReactNode
}): React.JSX.Element {
  // Map of action → stack of handlers. Most-recently-registered is on top;
  // when a handler unmounts the one below it is reachable again.
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

  /** Walk the stack top → bottom; stop at the first handler that doesn't return `false`. */
  const dispatch = useCallback((action: ShortcutAction): boolean => {
    const live = handlersRef.current.get(action)
    if (!live || live.length === 0) return false
    // Snapshot: a handler may mount/unmount registrants while it runs.
    const stack = live.slice()
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i]() !== false) return true
    }
    return false
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const mod = e.ctrlKey || e.metaKey

      if (mod) {
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
          return
        }
        // Ctrl/⌘ + Enter — open in a new tab. Same guards as the bare keys
        // (Ctrl+Enter submits forms in editable fields).
        if (e.key === 'Enter' && !e.altKey && bareLayerAllowed(e)) {
          if (!e.repeat && dispatch('recordOpenNewTab')) e.preventDefault()
        }
        return
      }

      if (e.altKey || !bareLayerAllowed(e)) return

      if (e.code === 'Escape' || e.key === 'Escape') {
        if (dispatch('escape')) e.preventDefault()
        return
      }

      // `?` — Shift+Slash on a US layout; `e.key` covers other layouts.
      if ((e.code === 'Slash' && e.shiftKey) || e.key === '?') {
        if (e.repeat) return
        if (!dispatch('showHelpBare')) setHelpOpen(true)
        e.preventDefault()
        return
      }

      const action = BARE_KEY_ACTIONS[e.code]
      if (!action) return
      if (e.repeat && NO_REPEAT[action]) return
      // Enter on a focused button/link/menu item must keep activating it.
      if (action === 'recordOpen' && isInteractiveTarget(e.target)) return
      if (dispatch(action)) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [dispatch])

  const value = useMemo<ShortcutsContextValue>(
    () => ({ register, helpOpen, setHelpOpen }),
    [register, helpOpen],
  )

  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>
}

/** Guards shared by every non-Ctrl+K/N// key: IME, editable target, open overlay. */
function bareLayerAllowed(e: KeyboardEvent): boolean {
  if (e.isComposing) return false
  const target = e.target
  if (target instanceof HTMLElement && isEditableTarget(target)) return false
  return !document.querySelector(OVERLAY_SELECTOR)
}

function isEditableTarget(el: HTMLElement): boolean {
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return false
}

const INTERACTIVE_SELECTOR =
  'a[href], button, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="switch"], [role="option"]'

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null
}
