import { describe, it, expect } from 'vitest'
import { rubberBand, resolveAxis, springStep, PTR_CONST } from '../ptrPhysics'

describe('rubberBand', () => {
  it('returns 0 at or below zero travel', () => {
    expect(rubberBand(0, 800)).toBe(0)
    expect(rubberBand(-20, 800)).toBe(0)
  })
  it('is near-linear for small travel and stiffens (sub-linear) for large travel', () => {
    const h = 640
    const small = rubberBand(20, h)
    expect(small).toBeGreaterThan(15)        // ~1:1 early
    expect(small).toBeLessThanOrEqual(20)
    const big = rubberBand(400, h)
    expect(big).toBeLessThan(400 * 0.42)     // asymptote below c*H
  })
  it('never reaches the c*H asymptote', () => {
    const h = 640
    expect(rubberBand(1e6, h)).toBeLessThan(0.42 * h)
  })
})

describe('resolveAxis', () => {
  it('locks vertical inside the cone dy>2|dx|', () => {
    expect(resolveAxis(5, 40)).toBe('v')
  })
  it('rejects to horizontal outside the cone', () => {
    expect(resolveAxis(40, 30)).toBe('x')
  })
  it('returns null until movement exceeds 12px', () => {
    expect(resolveAxis(3, 5)).toBeNull()
  })
})

describe('springStep', () => {
  it('converges toward the target and reports done when settled', () => {
    let s = { x: 0, v: 0 }
    let last = { x: 0, v: 0, done: false }
    for (let i = 0; i < 600; i++) {
      last = springStep(s.x, s.v, PTR_CONST.REST, 1 / 60)
      s = { x: last.x, v: last.v }
      if (last.done) break
    }
    expect(last.done).toBe(true)
    expect(Math.abs(last.x - PTR_CONST.REST)).toBeLessThan(0.5)
  })
})
