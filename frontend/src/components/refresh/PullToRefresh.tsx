import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PTR_CONST, rubberBand, resolveAxis, springStep } from '../../lib/ptrPhysics'
import { refreshAll } from '../../lib/globalRefresh'
import { RefreshRing, type PtrStage } from './RefreshRing'

const coarse = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(pointer: coarse)').matches &&
  'ontouchstart' in window

function buzz(ms: number) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* no-op */
  }
}

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<PtrStage>('idle')
  const [offset, setOffset] = useState(0)
  const st = useRef({
    dragging: false,
    startY: 0,
    startX: 0,
    axis: null as 'v' | 'x' | null,
    restedAt: 0,
    atTop: true,
    holdTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    stage: 'idle' as PtrStage,
  })

  const enabled = coarse()

  const rested = useCallback(
    () => st.current.atTop && performance.now() - st.current.restedAt >= PTR_CONST.REST_AT_TOP_MS,
    [],
  )

  const settle = useCallback(
    (to: number, then?: () => void) => {
      let x = offset
      let v = 0
      let last = performance.now()
      const tick = () => {
        const now = performance.now()
        const step = springStep(x, v, to, (now - last) / 1000)
        last = now
        x = step.x
        v = step.v
        setOffset(x)
        if (step.done) then?.()
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    },
    [offset],
  )

  const startRefresh = useCallback(() => {
    st.current.stage = 'refreshing'
    setStage('refreshing')
    settle(PTR_CONST.REST)
    void refreshAll(qc).then(() => {
      st.current.stage = 'done'
      setStage('done')
      buzz(12)
      setTimeout(() => {
        settle(0, () => {
          st.current.stage = 'idle'
          setStage('idle')
        })
      }, 420)
    })
  }, [qc, settle])

  useEffect(() => {
    const sc = scrollerRef.current
    if (!sc || !enabled) return

    const onScroll = () => {
      if (sc.scrollTop <= 1) {
        if (!st.current.atTop) {
          st.current.atTop = true
          st.current.restedAt = performance.now()
        }
      } else st.current.atTop = false
    }
    const onDown = (e: TouchEvent) => {
      if (st.current.stage === 'refreshing' || st.current.stage === 'done') return
      if (e.touches.length > 1) return
      if (sc.scrollTop > 1) return
      st.current.dragging = true
      st.current.axis = null
      st.current.startY = e.touches[0].clientY
      st.current.startX = e.touches[0].clientX
    }
    const onMove = (e: TouchEvent) => {
      const s = st.current
      if (!s.dragging) return
      if (e.touches.length > 1) {
        s.dragging = false
        settle(0)
        return
      }
      const dy = e.touches[0].clientY - s.startY
      const dx = e.touches[0].clientX - s.startX
      if (s.axis === null) {
        const a = resolveAxis(dx, dy)
        if (a === null) return
        if (a === 'x') {
          s.dragging = false
          return
        }
        s.axis = 'v'
      }
      if (sc.scrollTop > 1 || !rested()) return
      const raw = dy - PTR_CONST.DEAD
      if (raw <= 0) {
        setOffset(0)
        return
      }
      if (e.cancelable) e.preventDefault()
      const off = rubberBand(raw, Math.min(window.innerHeight, PTR_CONST.H_MAX))
      setOffset(Math.min(off, PTR_CONST.CLAMP))
      if (off >= PTR_CONST.ARM && s.stage !== 'armed') {
        if (!s.holdTimer)
          s.holdTimer = setTimeout(() => {
            s.stage = 'armed'
            setStage('armed')
            buzz(10)
            s.holdTimer = undefined
          }, PTR_CONST.HOLD_MS)
        if ((s.stage as PtrStage) !== 'armed') setStage((s.stage = 'pulling'))
      } else if (off < PTR_CONST.DISARM && s.stage === 'armed') {
        setStage((s.stage = 'pulling'))
        buzz(5)
      } else if (off < PTR_CONST.ARM) {
        if (s.holdTimer) {
          clearTimeout(s.holdTimer)
          s.holdTimer = undefined
        }
        if (s.stage !== 'armed') setStage((s.stage = 'pulling'))
      }
    }
    const onUp = () => {
      const s = st.current
      if (!s.dragging) return
      s.dragging = false
      if (s.holdTimer) {
        clearTimeout(s.holdTimer)
        s.holdTimer = undefined
      }
      if (s.stage === 'armed') startRefresh()
      else {
        setStage((s.stage = 'idle'))
        settle(0)
      }
    }

    sc.addEventListener('scroll', onScroll, { passive: true })
    sc.addEventListener('touchstart', onDown, { passive: true })
    sc.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    return () => {
      sc.removeEventListener('scroll', onScroll)
      sc.removeEventListener('touchstart', onDown)
      sc.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [enabled, rested, settle, startRefresh])

  const progress = offset / PTR_CONST.ARM

  return (
    <div className="relative h-full overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[170px] items-end justify-center pb-3.5">
        {(stage !== 'idle' || offset > 0) && <RefreshRing stage={stage} progress={progress} />}
      </div>
      <div
        data-ptr-scroller
        ref={scrollerRef}
        className="h-full overflow-y-auto overscroll-y-contain will-change-transform"
        style={{ transform: `translateY(${Math.min(offset, PTR_CONST.CLAMP)}px)` }}
      >
        {children}
      </div>
    </div>
  )
}
