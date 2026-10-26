import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Toaster } from 'sileo'
import { MotionGlobalConfig } from 'motion/react'

import {
  subscribeAnnouncements,
  type Announcement,
  type AnnouncementPriority,
} from '@/lib/toastAnnouncements'
import { reconcileToastGenerations, toast } from '@/lib/toast'
import { setToastHeld } from '@/lib/toastHold'

import './AppToaster.css'

/** How long a notice stays in the screen-reader regions before it is pruned. */
const ANNOUNCEMENT_TTL_MS = 10_000
const MAX_ANNOUNCEMENTS = 5

type ThemeName = 'light' | 'dark'

function subscribeRootAttributes(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

/** `<html data-theme>` is the app's theme source (lib/theme.ts); Sileo has no way to read it. */
function useDocumentTheme(): ThemeName {
  return useSyncExternalStore(
    subscribeRootAttributes,
    () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
    () => 'light',
  )
}

/**
 * Sileo animates its pill with motion's JS springs, which its own
 * `prefers-reduced-motion` CSS cannot reach. Skip them when the user asks.
 */
function useReducedMotionSync(): void {
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = (): void => {
      MotionGlobalConfig.skipAnimations = query.matches
    }
    apply()
    query.addEventListener('change', apply)
    return () => {
      query.removeEventListener('change', apply)
      MotionGlobalConfig.skipAnimations = false
    }
  }, [])
}

function useAnnouncements(): Announcement[] {
  const [items, setItems] = useState<Announcement[]>([])
  const timers = useRef(new Set<number>())
  useEffect(() => {
    const pending = timers.current
    const unsubscribe = subscribeAnnouncements((announcement) => {
      setItems((prev) => [...prev.slice(1 - MAX_ANNOUNCEMENTS), announcement])
      const timer = window.setTimeout(() => {
        pending.delete(timer)
        setItems((prev) => prev.filter((item) => item.seq !== announcement.seq))
      }, ANNOUNCEMENT_TTL_MS)
      pending.add(timer)
    })
    return () => {
      unsubscribe()
      for (const timer of pending) window.clearTimeout(timer)
      pending.clear()
    }
  }, [])
  return items
}

function AnnouncementRegion({
  priority,
  items,
}: {
  priority: AnnouncementPriority
  items: Announcement[]
}): React.JSX.Element {
  return (
    <div
      className="sr-only"
      role={priority === 'assertive' ? 'alert' : 'status'}
      aria-live={priority}
      data-toast-announcer={priority}
    >
      {items
        .filter((item) => item.priority === priority)
        .map((item) => (
          <p key={item.seq}>{item.text}</p>
        ))}
    </div>
  )
}

const SILEO_ID_PREFIX = 'sileo-gooey-'

/**
 * Sileo does not expose a toast's id on its DOM, but each toast's SVG filter is
 * `sileo-gooey-<id>`. AppToaster.test.tsx pins that against the real package.
 */
function toastIdOf(toastEl: Element): string | null {
  const filter = toastEl.querySelector(`filter[id^="${SILEO_ID_PREFIX}"]`)
  return filter ? filter.id.slice(SILEO_ID_PREFIX.length) : null
}

function closestToast(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-sileo-toast]') : null
}

/**
 * Sileo pauses a toast's timer and expands its description only on mouse
 * hover. Re-use that path for keyboard focus by replaying the hover events
 * React's `onMouseEnter`/`onMouseLeave` listen for.
 */
function replayHover(toastEl: HTMLElement, type: 'mouseover' | 'mouseout'): void {
  toastEl.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: null }))
}

/**
 * Sileo sets its "hovered" flag on a toast's mouseenter and clears it only on a
 * mouseleave. A toast that closes under the pointer or focus (a click, Escape, an
 * Undo, `toast.dismiss()`) never sends one, so every later toast would stay up
 * forever. Once the engaged toast is closing or gone, and a live toast exists,
 * send that leave through the live one.
 */
function releaseStaleHover(root: HTMLElement, engaged: { current: HTMLElement | null }): void {
  const held = engaged.current
  if (!held || (held.isConnected && held.dataset.exiting !== 'true')) return
  const live = root.querySelector<HTMLElement>('[data-sileo-toast]:not([data-exiting="true"])')
  if (!live) return
  engaged.current = null
  setToastHeld(false)
  replayHover(live, 'mouseout')
}

/**
 * Sileo's `aria-live` viewport exists only while a toast does, so it announces
 * unreliably; the always-mounted regions above do that job. Silence the viewport
 * so a notice is not read twice, and hide the decorative canvas and state icon
 * (their SVG titles would otherwise become the toast's accessible name).
 */
function tidyAccessibility(root: HTMLElement): void {
  root.querySelectorAll('[data-sileo-viewport]').forEach((viewport) => {
    if (viewport.getAttribute('aria-live') !== 'off') viewport.setAttribute('aria-live', 'off')
  })
  root.querySelectorAll('[data-sileo-canvas], [data-sileo-badge]').forEach((decorative) => {
    if (decorative.getAttribute('aria-hidden') !== 'true') decorative.setAttribute('aria-hidden', 'true')
  })
}

/**
 * Mounts the one Sileo host for the shell. Notices are raised through
 * `@/lib/toast`, never through `sileo` directly.
 */
export function AppToaster(): React.JSX.Element {
  const theme = useDocumentTheme()
  const rootRef = useRef<HTMLDivElement>(null)
  // The toast currently holding Sileo's hover flag, by pointer or by focus.
  const engaged = useRef<HTMLElement | null>(null)
  const announcements = useAnnouncements()
  useReducedMotionSync()

  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const observer = new MutationObserver(() => {
      tidyAccessibility(root)
      releaseStaleHover(root, engaged)
      reconcileToastGenerations(
        Array.from(root.querySelectorAll<HTMLElement>('[data-sileo-toast]'), (el) => ({
          id: toastIdOf(el) ?? '',
          exiting: el.dataset.exiting === 'true',
        })),
      )
    })
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-exiting'] })
    tidyAccessibility(root)
    return () => observer.disconnect()
  }, [])

  return (
    // Wrapped so print can hide it: the viewport is fixed, but a trailing in-flow
    // box after a named-@page element (the permits register) costs a blank sheet.
    <div
      ref={rootRef}
      data-print-hide
      onClick={(event) => {
        const toastEl = closestToast(event.target)
        if (!toastEl || toastEl.dataset.state === 'loading') return
        if ((event.target as Element).closest('[data-sileo-button]')) return
        const id = toastIdOf(toastEl)
        if (id) toast.dismiss(id)
      }}
      onMouseOver={(event) => {
        const toastEl = closestToast(event.target)
        if (!toastEl) return
        engaged.current = toastEl
        setToastHeld(true)
      }}
      onMouseOut={(event) => {
        const toastEl = closestToast(event.target)
        if (toastEl && toastEl === engaged.current && !toastEl.contains(event.relatedTarget as Node | null)) {
          engaged.current = null
          setToastHeld(false)
        }
      }}
      onFocus={(event) => {
        const toastEl = closestToast(event.target)
        if (!toastEl) return
        engaged.current = toastEl
        setToastHeld(true)
        replayHover(toastEl, 'mouseover')
      }}
      onBlur={(event) => {
        const toastEl = closestToast(event.target)
        if (toastEl && !toastEl.contains(event.relatedTarget as Node | null)) {
          engaged.current = null
          setToastHeld(false)
          replayHover(toastEl, 'mouseout')
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        const toastEl = closestToast(event.target)
        const id = toastEl ? toastIdOf(toastEl) : null
        if (id) toast.dismiss(id)
      }}
    >
      <Toaster position="top-center" offset={{ top: 'calc(12px + env(safe-area-inset-top))' }} theme={theme} />
      <AnnouncementRegion priority="polite" items={announcements} />
      <AnnouncementRegion priority="assertive" items={announcements} />
    </div>
  )
}
