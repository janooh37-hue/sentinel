/**
 * RecordChrome — the record page's layout toggles in one place, so the header,
 * desk, rail and dock agree without prop-drilling through BookRecordPage.
 *
 *   rail        persisted in localStorage (`gssg.books.record.rail`); the
 *               desktop rail beside the desk. Open by default (proto `railDefault`).
 *   railDrawer  below `RAIL_BREAKPOINT` the rail is an overlay drawer instead;
 *               transient, never persisted.
 *   focus       focus mode (chrome hidden); sessionStorage
 *               (`gssg.books.record.focus`) so a reload keeps it within the
 *               tab session but a new session starts with the chrome visible.
 *   fullscreen  the phone paper viewer; never persisted.
 *
 * `toggleRail()` is the single entry point for the header button and the rail's
 * own toggles (there is no keyboard shortcut for the rail): width decides
 * whether it opens the drawer or flips the rail (proto:1081).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

/** Same width the rail switches from drawer to docked column (the `xl` tier). */
export const RAIL_BREAKPOINT = 1280

export const RAIL_STORAGE_KEY = 'gssg.books.record.rail'
export const FOCUS_STORAGE_KEY = 'gssg.books.record.focus'

export interface RecordChrome {
  rail: 'open' | 'closed'
  railDrawerOpen: boolean
  toggleRail: () => void
  closeRailDrawer: () => void
  focus: boolean
  setFocus: (value: boolean) => void
  fullscreen: boolean
  setFullscreen: (value: boolean) => void
}

function readRail(): 'open' | 'closed' {
  try {
    return window.localStorage.getItem(RAIL_STORAGE_KEY) === 'closed' ? 'closed' : 'open'
  } catch {
    return 'open'
  }
}

function writeRail(value: 'open' | 'closed'): void {
  try {
    window.localStorage.setItem(RAIL_STORAGE_KEY, value)
  } catch {
    // Persistence is best-effort.
  }
}

function readFocus(): boolean {
  try {
    return window.sessionStorage.getItem(FOCUS_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeFocus(value: boolean): void {
  try {
    if (value) window.sessionStorage.setItem(FOCUS_STORAGE_KEY, '1')
    else window.sessionStorage.removeItem(FOCUS_STORAGE_KEY)
  } catch {
    // Persistence is best-effort.
  }
}

const RecordChromeContext = createContext<RecordChrome | null>(null)

export function RecordChromeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [rail, setRail] = useState<'open' | 'closed'>(readRail)
  const [railDrawerOpen, setRailDrawerOpen] = useState(false)
  const [focus, setFocusState] = useState<boolean>(readFocus)
  const [fullscreen, setFullscreen] = useState(false)

  // Mirrors `rail` so toggling reads the latest value without a side effect
  // inside a state updater (StrictMode double-invokes those).
  const railRef = useRef(rail)

  const toggleRail = useCallback(() => {
    if (window.innerWidth < RAIL_BREAKPOINT) {
      setRailDrawerOpen((open) => !open)
      return
    }
    const next = railRef.current === 'open' ? 'closed' : 'open'
    railRef.current = next
    writeRail(next)
    setRail(next)
  }, [])

  const closeRailDrawer = useCallback(() => setRailDrawerOpen(false), [])

  const setFocus = useCallback((value: boolean) => {
    writeFocus(value)
    setFocusState(value)
    // Focus mode hides the rail, so an open drawer would be invisible yet
    // still swallow the first Esc.
    if (value) setRailDrawerOpen(false)
  }, [])

  // Growing past the breakpoint (rotate, window resize) docks the rail, so a
  // drawer left open would otherwise reappear when the window narrows again.
  useEffect(() => {
    const onResize = (): void => {
      if (window.innerWidth >= RAIL_BREAKPOINT) setRailDrawerOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const value = useMemo<RecordChrome>(
    () => ({
      rail,
      railDrawerOpen,
      toggleRail,
      closeRailDrawer,
      focus,
      setFocus,
      fullscreen,
      setFullscreen,
    }),
    [rail, railDrawerOpen, toggleRail, closeRailDrawer, focus, setFocus, fullscreen],
  )

  return <RecordChromeContext.Provider value={value}>{children}</RecordChromeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRecordChrome(): RecordChrome {
  const ctx = useContext(RecordChromeContext)
  if (!ctx) throw new Error('useRecordChrome must be used within RecordChromeProvider')
  return ctx
}
