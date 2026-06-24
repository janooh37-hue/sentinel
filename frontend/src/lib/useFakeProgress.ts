import { useEffect, useReducer, useRef, useState } from 'react'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** True when the user has requested reduced motion. SSR-safe default: false. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia(REDUCED_MOTION_QUERY).matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(REDUCED_MOTION_QUERY)
    const onChange = (): void => setReduced(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/**
 * useFakeProgress — perceived-performance progress for an unknowable-duration
 * task (here: backend DOCX + PDF build behind a job poll).
 *
 * Phases:
 *   1. Fast fill   — 0 → FAST_TARGET (~80%) over FAST_MS with an ease-out
 *                    curve, so it feels like real work is flying by.
 *   2. Slow crawl  — FAST_TARGET → CRAWL_CEIL (~95%) via decaying increments;
 *                    it never reaches the ceiling on its own ("almost done").
 *   3. Settle      — when `done` flips true, snap to 100, hold HOLD_MS, hide.
 *
 * Driven declaratively by `{ active, done }`:
 *   - active true                 → run phases 1–2
 *   - active true → done true     → snap to 100, hold, then hide
 *   - active true → active false  → stop and hide cleanly (error / cancel),
 *                                    no stuck bar
 *
 * Reduced motion: skips the animated crawl. While working it parks at a
 * steady FAST_TARGET; on done it shows 100 then hides after the same hold.
 *
 * rAF-driven; all timers/frames are torn down on unmount.
 */

const FAST_TARGET = 80 // % reached by the end of the fast fill
const CRAWL_CEIL = 95 // asymptote the slow crawl approaches but never hits
const FAST_MS = 700 // duration of the fast fill (within the 600–800ms brief)
const CRAWL_RATE = 0.00008 // per-ms decay factor for the crawl increments
const HOLD_MS = 320 // how long 100% is held before hiding

// ease-out (cubic) — fast then decelerating, no overshoot/bounce.
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

interface State {
  value: number
  visible: boolean
}

type Action =
  | { type: 'set'; value: number }
  | { type: 'show' }
  | { type: 'hide' }
  | { type: 'reset' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'set':
      return { ...state, value: action.value }
    case 'show':
      return { value: 0, visible: true }
    case 'hide':
      return { ...state, visible: false }
    case 'reset':
      return { value: 0, visible: false }
  }
}

export interface UseFakeProgressOptions {
  /** The task is in flight (job queued/running). */
  active: boolean
  /** The task completed successfully — snap to 100, hold, hide. */
  done: boolean
  /** Honor prefers-reduced-motion by skipping the animated crawl. */
  reducedMotion?: boolean
}

export interface FakeProgress {
  /** 0–100. */
  value: number
  /** Whether the bar should be rendered at all (false once hidden). */
  visible: boolean
}

export function useFakeProgress({
  active,
  done,
  reducedMotion = false,
}: UseFakeProgressOptions): FakeProgress {
  const [state, dispatch] = useReducer(reducer, { value: 0, visible: false })

  const rafRef = useRef<number | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const valueRef = useRef(0)
  const startRef = useRef(0)
  // Latest props the rAF loop should read without re-subscribing each frame.
  const doneRef = useRef(done)
  const reducedRef = useRef(reducedMotion)
  useEffect(() => {
    doneRef.current = done
    reducedRef.current = reducedMotion
  })

  function cancelRaf(): void {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }
  function clearHide(): void {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  function push(v: number): void {
    valueRef.current = v
    dispatch({ type: 'set', value: v })
  }

  // Settle to 100, hold, then hide. Shared by both motion modes.
  function settle(): void {
    cancelRaf()
    push(100)
    clearHide()
    hideTimerRef.current = setTimeout(() => dispatch({ type: 'hide' }), HOLD_MS)
  }

  useEffect(() => {
    if (done && state.visible) {
      // Completed → snap to 100, hold, hide. Fires regardless of `active`
      // because the parent typically flips active→false and done→true in the
      // same render. Also covers reduced-motion (no rAF loop to self-settle).
      settle()
      return
    }
    if (active && !state.visible && !done) {
      // Start a fresh run.
      dispatch({ type: 'show' })
      valueRef.current = 0
      startRef.current = performance.now()
      clearHide()

      if (reducedRef.current) {
        // No crawl: park at the fast target; settle handles done.
        push(FAST_TARGET)
        return
      }

      let last = startRef.current
      const tick = (now: number): void => {
        if (doneRef.current) {
          settle()
          return
        }
        const elapsed = now - startRef.current
        if (elapsed < FAST_MS) {
          push(easeOut(elapsed / FAST_MS) * FAST_TARGET)
        } else {
          // Decaying crawl toward CRAWL_CEIL.
          const dt = now - last
          const remaining = CRAWL_CEIL - valueRef.current
          push(valueRef.current + remaining * (1 - Math.exp(-CRAWL_RATE * dt)))
        }
        last = now
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
      return
    }
    if (!active && state.visible && !done) {
      // Error / cancel — drop the bar cleanly, no snap to 100.
      cancelRaf()
      clearHide()
      dispatch({ type: 'reset' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, done, state.visible])

  useEffect(
    () => () => {
      cancelRaf()
      clearHide()
    },
    [],
  )

  return { value: state.value, visible: state.visible }
}
