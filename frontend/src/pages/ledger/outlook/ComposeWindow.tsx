/**
 * ComposeWindow — non-modal Outlook-style frame for the Ledger compose surface.
 *
 * Desktop: a single `position: fixed` panel portalled to document.body (escapes
 * the route-transition transform stacking context). NO backdrop and NO
 * `aria-modal` — the mailbox behind stays fully clickable while you compose. The
 * panel positions itself by window state:
 *   - normal     → docked bottom-right (or wherever the user dragged it)
 *   - minimized  → a slim title strip docked bottom-right (child hides its body)
 *   - maximized  → large centered window (the DEFAULT on open)
 * State + setters are handed to the child via a render-prop so the child (which
 * owns the title bar + close/draft guard) renders the min/max/close controls.
 *
 * Window behaviors (like a normal OS window):
 *   - Opens MAXIMIZED by default.
 *   - Drag-to-move: the child spreads `dragHandleProps` on its title bar.
 *     Dragging applies only in normal state; dragging a MAXIMIZED window first
 *     restores it to normal sized under the pointer (Windows/Outlook style).
 *     The dragged position (`customPos`) replaces the docked bottom-right
 *     anchor with inline left/top and SURVIVES minimize/maximize round-trips
 *     for the life of the window. Drags are clamped so the title bar always
 *     stays grabbable (≥ ~120px of the window visible horizontally; the title
 *     bar never above the viewport top or below its bottom edge).
 *   - Resize: CSS-native (`resize: both`) in normal state only, with
 *     min 420×320 / max 96vw×92vh. KNOWN LIMITATION: the native handle sits at
 *     the single inline-end bottom corner and is modest; full 8-direction
 *     resize is out of scope. A user-resized width/height is stashed while
 *     minimized/maximized and re-applied on restore.
 *
 * Docking uses physical `right-4` deliberately — the ledger chrome is LTR-pinned
 * (does not mirror in Arabic), so the panel sits bottom-right in both languages.
 *
 * Mobile (fullScreen): the prior full-screen `absolute inset-0` passthrough.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

export type ComposeWindowState = 'normal' | 'minimized' | 'maximized'

export interface ComposeWindowControls {
  state: ComposeWindowState
  minimize: () => void
  /** Toggle maximize ⇄ normal. */
  maximize: () => void
  /** Back to the normal docked panel (from minimized or maximized). */
  restore: () => void
  /** Spread on the title-bar container to make it the drag-to-move handle. */
  dragHandleProps: { onPointerDown: (e: React.PointerEvent) => void }
}

interface ComposeWindowProps {
  fullScreen: boolean
  children: (win: ComposeWindowControls) => React.ReactNode
}

/** Size + chrome of the normal window, shared by docked and dragged positions. */
const NORMAL_SIZE =
  'h-[72vh] max-h-[92vh] w-[min(640px,94vw)] min-w-[420px] min-h-[320px] max-w-[96vw] rounded-xl border border-border shadow-2xl'

const POSITION: Record<ComposeWindowState, string> = {
  normal: NORMAL_SIZE,
  maximized:
    'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[86vh] w-[min(1200px,92vw)] rounded-xl border border-border shadow-2xl',
  minimized:
    'bottom-0 right-4 h-auto w-[min(320px,80vw)] rounded-t-lg border border-b-0 border-border shadow-2xl',
}

/** Fallback width used to place the window under the pointer when a maximized drag restores it. */
const RESTORE_DRAG_WIDTH = 640
/** Horizontal slice of the window that must stay on-screen so the title bar remains grabbable. */
const MIN_VISIBLE_X = 120
/** Title-bar height allowance for the vertical clamp. */
const TITLE_BAR_H = 48

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

export function ComposeWindow({ fullScreen, children }: ComposeWindowProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<ComposeWindowState>('maximized')
  /** User-dragged position; applies ONLY in 'normal' state (inline left/top instead of the docked bottom-right anchor). */
  const [customPos, setCustomPos] = useState<{ x: number; y: number } | null>(null)
  /** User-resized width/height (browser-written inline styles), stashed while not in 'normal' state. */
  const stashedSizeRef = useRef<{ width: string; height: string } | null>(null)

  const onDragPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    if (state !== 'normal' && state !== 'maximized') return
    // Don't hijack clicks on the window controls / fields inside the handle.
    if ((e.target as HTMLElement).closest('button, input, a')) return
    // Resolve the panel from the event (not dialogRef) — the React Compiler
    // refs rule can't tell this render-prop closure only runs on pointerdown.
    const node = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-compose-window]')
    if (!node) return

    const rect = node.getBoundingClientRect()
    let startLeft = rect.left
    let startTop = rect.top
    let width = rect.width
    if (state === 'maximized') {
      // Windows-style: dragging a maximized window restores it to normal size
      // positioned so the pointer stays within the title bar.
      width = RESTORE_DRAG_WIDTH
      startLeft = clamp(
        e.clientX - RESTORE_DRAG_WIDTH / 2,
        8 - width + MIN_VISIBLE_X,
        window.innerWidth - MIN_VISIBLE_X,
      )
      startTop = clamp(e.clientY - 20, 0, window.innerHeight - TITLE_BAR_H)
      setState('normal')
      setCustomPos({ x: startLeft, y: startTop })
    }

    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture?.(e.pointerId)
    const startClientX = e.clientX
    const startClientY = e.clientY

    const onMove = (ev: PointerEvent) => {
      ev.preventDefault() // suppress text selection while dragging
      setCustomPos({
        x: clamp(
          startLeft + ev.clientX - startClientX,
          8 - width + MIN_VISIBLE_X,
          window.innerWidth - MIN_VISIBLE_X,
        ),
        y: clamp(startTop + ev.clientY - startClientY, 0, window.innerHeight - TITLE_BAR_H),
      })
    }
    const onEnd = (ev: PointerEvent) => {
      handle.releasePointerCapture?.(ev.pointerId)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onEnd)
      handle.removeEventListener('pointercancel', onEnd)
    }
    // Pointer capture routes move/up to the handle element itself.
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onEnd)
    handle.addEventListener('pointercancel', onEnd)
  }

  const controls: ComposeWindowControls = {
    state,
    minimize: () => setState('minimized'),
    maximize: () => setState((s) => (s === 'maximized' ? 'normal' : 'maximized')),
    restore: () => setState('normal'),
    dragHandleProps: { onPointerDown: onDragPointerDown },
  }

  // Focus the first field when the panel first opens. Deliberately mount-only
  // (deps: [fullScreen]) — refocusing on every state change would yank the caret
  // out of the editor when the user maximizes/restores.
  useEffect(() => {
    if (fullScreen) return
    const node = dialogRef.current
    if (!node) return
    const field = node.querySelector<HTMLElement>('input, textarea, [contenteditable="true"]')
    const focusable = field ?? node.querySelector<HTMLElement>('button, [tabindex]:not([tabindex="-1"])')
    ;(focusable ?? node).focus()
  }, [fullScreen])

  // The native resize handle writes inline width/height that React doesn't
  // track — stash them when leaving 'normal' (they'd override the maximized /
  // minimized preset sizes) and re-apply on restore.
  useEffect(() => {
    const node = dialogRef.current
    if (!node || fullScreen) return
    if (state === 'normal') {
      if (stashedSizeRef.current) {
        node.style.width = stashedSizeRef.current.width
        node.style.height = stashedSizeRef.current.height
        stashedSizeRef.current = null
      }
    } else if (node.style.width || node.style.height) {
      stashedSizeRef.current = { width: node.style.width, height: node.style.height }
      node.style.width = ''
      node.style.height = ''
    }
  }, [state, fullScreen])

  if (fullScreen) {
    return <div className="absolute inset-0 z-20 flex bg-background">{children(controls)}</div>
  }

  const dragged = state === 'normal' && customPos !== null

  return createPortal(
    <div
      ref={dialogRef}
      data-compose-window=""
      data-testid="compose-window-root"
      data-state={state}
      role="dialog"
      aria-labelledby="ledger-compose-title"
      tabIndex={-1}
      className={cn(
        'fixed z-50 flex flex-col overflow-hidden bg-surface focus:outline-none',
        'animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none',
        POSITION[state],
        state === 'normal' && 'resize',
        state === 'normal' && !dragged && 'bottom-4 right-4',
      )}
      style={dragged ? { left: customPos.x, top: customPos.y } : undefined}
    >
      {children(controls)}
    </div>,
    document.body,
  )
}
