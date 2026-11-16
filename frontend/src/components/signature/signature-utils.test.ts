import { describe, expect, it } from 'vitest'

import {
  cornerDragWidthPt,
  MIN_SIGNATURE_WIDTH_PT,
  mmToPt,
  resizeToWidth,
} from './signature-utils'

// A4 in points; a 2:1 signature (height = width / 2).
const PAGE_W = 595
const PAGE_H = 842
const ASPECT = 0.5

describe('resizeToWidth', () => {
  it('keeps the top-left and takes the requested width when it fits', () => {
    const next = resizeToWidth({ x: 0.2, y: 0.3, widthPt: 90 }, 120, ASPECT, PAGE_W, PAGE_H)
    expect(next).toEqual({ x: 0.2, y: 0.3, widthPt: 120 })
  })

  it('never goes below 10 mm', () => {
    const next = resizeToWidth({ x: 0.2, y: 0.3, widthPt: 90 }, 5, ASPECT, PAGE_W, PAGE_H)
    expect(next.widthPt).toBeCloseTo(mmToPt(10))
    expect(next.widthPt).toBe(MIN_SIGNATURE_WIDTH_PT)
  })

  it('stops growing at the right page edge', () => {
    const next = resizeToWidth({ x: 0.8, y: 0.3, widthPt: 90 }, 300, ASPECT, PAGE_W, PAGE_H)
    expect(next.x).toBe(0.8)
    expect(next.x * PAGE_W + next.widthPt).toBeCloseTo(PAGE_W)
  })

  it('stops growing at the bottom page edge, using the locked height', () => {
    const y = 1 - 100 / PAGE_H // 100 pt of room below the top edge
    const next = resizeToWidth({ x: 0.1, y, widthPt: 90 }, 400, ASPECT, PAGE_W, PAGE_H)
    expect(next.widthPt).toBeCloseTo(200) // height 100 pt
    expect(next.y * PAGE_H + next.widthPt * ASPECT).toBeCloseTo(PAGE_H)
  })

  it('moves the top-left back when even the minimum width would leave the page', () => {
    const next = resizeToWidth({ x: 0.99, y: 0.999, widthPt: 90 }, 5, ASPECT, PAGE_W, PAGE_H)
    expect(next.widthPt).toBe(MIN_SIGNATURE_WIDTH_PT)
    expect(next.x * PAGE_W + next.widthPt).toBeLessThanOrEqual(PAGE_W + 1e-9)
    expect(next.y * PAGE_H + next.widthPt * ASPECT).toBeLessThanOrEqual(PAGE_H + 1e-9)
  })

  it('ignores a non-finite request', () => {
    const frame = { x: 0.2, y: 0.3, widthPt: 90 }
    expect(resizeToWidth(frame, Number.NaN, ASPECT, PAGE_W, PAGE_H)).toBe(frame)
  })
})

describe('cornerDragWidthPt', () => {
  // Page rendered at 1190 px wide → 2 px per pt.
  const box = { page: 1, left: 10, top: 20, width: PAGE_W * 2, height: PAGE_H * 2 }

  it('converts a horizontal reach from the top-left into points', () => {
    expect(cornerDragWidthPt(box, 100, 100, 100 + 240, 100 + 10, ASPECT, PAGE_W)).toBeCloseTo(120)
  })

  it('uses the vertical reach through the aspect ratio when it is larger', () => {
    // 120 px down at 2:1 → 240 px wide → 120 pt.
    expect(cornerDragWidthPt(box, 100, 100, 100 + 10, 100 + 120, ASPECT, PAGE_W)).toBeCloseTo(120)
  })
})
