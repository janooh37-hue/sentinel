/**
 * usePanZoom — transform-based pan/zoom math + pointer-gesture hook for the
 * mobile email-body reading surface (Phase 1 Workstream C).
 *
 * The record-PDF viewer (`pages/books/RecordPaperViewer.tsx`) pans by scrolling
 * a container whose pdf.js canvases are re-rendered at each zoom step. That can't
 * work for a live email body: its HTML has an intrinsic (often wide) width that
 * cannot be reflowed, so we instead transform the body wholesale via
 * `transform: translate(x,y) scale(s)` with `transform-origin:0 0` — the same
 * approach the approved mockup uses (`initPZ`/`pzFit`/`pzZoom` in
 * docs/prototypes/ledger-fixes-2026-06-25.html §4). We mirror RecordPaperViewer's
 * grab-to-pan *pattern* (pointer capture + grab cursor) over that transform.
 *
 * The pure functions below are exported and unit-tested; the hook wires them to
 * pointer/touch/wheel events.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** Hard upper bound on zoom (the lower bound is the per-content fit scale). */
export const MAX_SCALE = 3
/** Multiplicative step for the −/+ buttons and wheel ticks. */
export const ZOOM_STEP = 1.25

export interface PanZoomState {
  /** content width / viewport width fit scale (≤ 1). */
  fit: number
  scale: number
  x: number
  y: number
}

/**
 * Fit-to-width: the largest scale ≤ 1 that makes `contentWidth` fit `viewport`,
 * and the x offset that centres the (possibly narrower) content horizontally.
 * y is a small top inset. Mirrors the mockup's `pzFit`.
 */
export function computeFit(viewportWidth: number, contentWidth: number): PanZoomState {
  const cw = contentWidth > 0 ? contentWidth : 1
  const avail = viewportWidth > 0 ? viewportWidth : cw
  const fit = Math.min(1, avail / cw)
  const x = Math.max(0, (avail - cw * fit) / 2)
  return { fit, scale: fit, x, y: 8 }
}

/**
 * Clamp a scale into `[fit * 0.9, MAX_SCALE]`. The small slack below `fit`
 * (matching the mockup) lets the user nudge slightly under fit without snapping.
 */
export function clampScale(scale: number, fit: number): number {
  const lo = fit * 0.9
  return Math.min(MAX_SCALE, Math.max(lo, scale))
}

/**
 * Clamp the pan offset so the scaled content can't be dragged completely out of
 * the viewport. When the content is smaller than the viewport on an axis the
 * offset is pinned to the centred position; otherwise it may range so that
 * neither edge crosses past the opposite viewport edge, with a small margin.
 */
export function clampPan(
  x: number,
  y: number,
  scale: number,
  viewportWidth: number,
  viewportHeight: number,
  contentWidth: number,
  contentHeight: number,
  margin = 40,
): { x: number; y: number } {
  return {
    x: clampAxis(x, scale, viewportWidth, contentWidth, margin),
    y: clampAxis(y, scale, viewportHeight, contentHeight, margin),
  }
}

function clampAxis(
  offset: number,
  scale: number,
  viewport: number,
  content: number,
  margin: number,
): number {
  const scaled = content * scale
  if (scaled <= viewport) {
    // Content fits this axis — keep it centred (clamped to ≥ 0 top/left inset).
    return Math.max(0, (viewport - scaled) / 2)
  }
  // Content overflows — allow panning but keep at least `margin` of it on screen.
  const min = viewport - scaled - margin
  const max = margin
  return Math.min(max, Math.max(min, offset))
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export interface UsePanZoom {
  viewportRef: React.RefObject<HTMLDivElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
  state: PanZoomState
  grabbing: boolean
  /** `transform` string for the content layer. */
  transform: string
  /** Re-measure content + reset to fit (call after the body HTML mounts). */
  reset: () => void
  zoomBy: (dir: 1 | -1) => void
  handlers: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void
    onWheel: (e: React.WheelEvent<HTMLDivElement>) => void
  }
}

/**
 * Pointer/touch/wheel pan-zoom over a transform layer. The caller renders a
 * positioned viewport (`touch-action:none; overflow:hidden`) holding a content
 * layer it sizes; pass refs to both.
 */
export function usePanZoom(): UsePanZoom {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<PanZoomState>({ fit: 1, scale: 1, x: 0, y: 8 })
  const [grabbing, setGrabbing] = useState(false)

  // Live gesture bookkeeping (refs — not render state).
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const drag = useRef<{ sx: number; sy: number } | null>(null)
  const pinch = useRef<{ startDist: number; startScale: number } | null>(null)
  const fitRef = useRef(1)

  const dims = useCallback(() => {
    const vp = viewportRef.current
    const ct = contentRef.current?.firstElementChild as HTMLElement | null
    return {
      vw: vp?.clientWidth ?? 0,
      vh: vp?.clientHeight ?? 0,
      cw: ct?.offsetWidth ?? 0,
      ch: ct?.offsetHeight ?? 0,
    }
  }, [])

  const reset = useCallback(() => {
    const { vw, cw } = dims()
    const next = computeFit(vw, cw)
    fitRef.current = next.fit
    setState(next)
  }, [dims])

  const zoomBy = useCallback(
    (dir: 1 | -1) => {
      setState((s) => {
        const scale = clampScale(s.scale * (dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP), s.fit)
        const { vw, vh, cw, ch } = dims()
        const { x, y } = clampPan(s.x, s.y, scale, vw, vh, cw, ch)
        return { ...s, scale, x, y }
      })
    },
    [dims],
  )

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const vp = viewportRef.current
    if (!vp) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    vp.setPointerCapture(e.pointerId)
    if (pointers.current.size === 1) {
      drag.current = { sx: e.clientX, sy: e.clientY }
      pinch.current = null
      setGrabbing(true)
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      drag.current = null
      setGrabbing(false)
      setState((s) => {
        pinch.current = { startDist: distance(a, b), startScale: s.scale }
        return s
      })
    }
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pointers.current.has(e.pointerId)) return
      const prev = pointers.current.get(e.pointerId)
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (pointers.current.size >= 2 && pinch.current) {
        const [a, b] = [...pointers.current.values()]
        const d = distance(a, b)
        const ratio = pinch.current.startDist > 0 ? d / pinch.current.startDist : 1
        setState((s) => {
          const scale = clampScale(pinch.current!.startScale * ratio, s.fit)
          const { vw, vh, cw, ch } = dims()
          const { x, y } = clampPan(s.x, s.y, scale, vw, vh, cw, ch)
          return { ...s, scale, x, y }
        })
        return
      }

      if (drag.current && prev) {
        const dx = e.clientX - prev.x
        const dy = e.clientY - prev.y
        setState((s) => {
          const { vw, vh, cw, ch } = dims()
          const { x, y } = clampPan(s.x + dx, s.y + dy, s.scale, vw, vh, cw, ch)
          return { ...s, x, y }
        })
      }
    },
    [dims],
  )

  const endPointer = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) {
      drag.current = null
      pinch.current = null
      setGrabbing(false)
    } else if (pointers.current.size === 1) {
      // Dropped from a pinch to a single finger — resume dragging from it.
      const [only] = [...pointers.current.values()]
      drag.current = { sx: only.x, sy: only.y }
      pinch.current = null
    }
  }, [])

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      zoomBy(e.deltaY < 0 ? 1 : -1)
    },
    [zoomBy],
  )

  // Re-fit on viewport resize (orientation change etc.).
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => reset())
    ro.observe(vp)
    return () => ro.disconnect()
  }, [reset])

  const transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`

  return {
    viewportRef,
    contentRef,
    state,
    grabbing,
    transform,
    reset,
    zoomBy,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
      onWheel,
    },
  }
}
