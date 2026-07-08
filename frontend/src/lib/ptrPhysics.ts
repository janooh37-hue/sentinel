export const PTR_CONST = Object.freeze({
  DEAD: 24,
  C: 0.42,
  H_MAX: 640,
  CLAMP: 160,
  ARM: 112,
  DISARM: 96,
  HOLD_MS: 120,
  REST_AT_TOP_MS: 250,
  REST: 56,
  DIR_MIN: 12, // px before axis lock decides
  SPRING_K: 260,
  SPRING_D: 26,
  SPRING_M: 1,
})

/** iOS-style asymptotic rubber band. rawPastDeadzone is finger travel already
 *  reduced by the dead zone. */
export function rubberBand(rawPastDeadzone: number, viewportH: number): number {
  if (rawPastDeadzone <= 0) return 0
  const H = Math.min(viewportH, PTR_CONST.H_MAX)
  const c = PTR_CONST.C
  return (rawPastDeadzone * c) / (c + rawPastDeadzone / H)
}

export function resolveAxis(dx: number, dy: number): 'v' | 'x' | null {
  if (Math.abs(dx) < PTR_CONST.DIR_MIN && Math.abs(dy) < PTR_CONST.DIR_MIN) return null
  return dy > 0 && dy > 2 * Math.abs(dx) ? 'v' : 'x'
}

/** One semi-implicit Euler spring step toward target. */
export function springStep(
  x: number,
  v: number,
  target: number,
  dtSec: number,
): { x: number; v: number; done: boolean } {
  const dt = Math.min(dtSec, 0.032)
  const fs = -PTR_CONST.SPRING_K * (x - target)
  const fd = -PTR_CONST.SPRING_D * v
  const a = (fs + fd) / PTR_CONST.SPRING_M
  const nv = v + a * dt
  const nx = x + nv * dt
  const done = Math.abs(nx - target) < 0.4 && Math.abs(nv) < 0.6
  return { x: done ? target : nx, v: done ? 0 : nv, done }
}
