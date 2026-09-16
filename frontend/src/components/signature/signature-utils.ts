/**
 * Pure helpers for the signature placement editor overlay — kept in a
 * non-component file so they're unit-testable, mirroring
 * `components/books/annotation-utils.ts`'s split.
 *
 * Coordinates are PHYSICAL (page-relative, normalized 0-1, measured from the
 * physical page's top-left, independent of UI language) — the same wire
 * contract `signature_layout.py`'s `SignatureGeometry` uses. RTL only
 * affects chrome in the component, never this math (approval-signature-
 * placement plan §9.9: "Physical PDF coordinate origins do not mirror").
 */

import type { PageBox } from '@/pages/application/DocPdfCanvas'

export interface SignatureRect {
  left: number
  top: number
  width: number
  height: number
}

/** Points per millimetre (25.4mm / 72pt). */
export const PT_PER_MM = 72 / 25.4

export function ptToMm(pt: number): number {
  return pt / PT_PER_MM
}

export function mmToPt(mm: number): number {
  return mm * PT_PER_MM
}

/** Map a signature's normalized (x, y) + physical size onto its page box → absolute px within the overlay. */
export function placeSignature(
  box: PageBox,
  x: number,
  y: number,
  widthPt: number,
  heightPt: number,
  pageWidthPt: number,
  pageHeightPt: number,
): SignatureRect {
  return {
    left: box.left + x * box.width,
    top: box.top + y * box.height,
    width: pageWidthPt > 0 ? (widthPt / pageWidthPt) * box.width : 0,
    height: pageHeightPt > 0 ? (heightPt / pageHeightPt) * box.height : 0,
  }
}

/** The page box containing a content-space point (px), or null. Identical to
 * `annotation-utils.pageAtPoint` — duplicated locally so this module has no
 * cross-feature import (annotation pins are review markup, not signature
 * state; plan §9.3 reuses only the MATH, not persistence). */
export function pageAtPoint(pages: PageBox[], cx: number, cy: number): PageBox | null {
  return (
    pages.find(
      (p) => cx >= p.left && cx <= p.left + p.width && cy >= p.top && cy <= p.top + p.height,
    ) ?? null
  )
}

/** Normalize a content-space point to 0-1 within a page box (clamped) —
 * the client-side preview clamp; the server independently validates the
 * saved request never silently clamping on its own. */
export function normalizePoint(box: PageBox, cx: number, cy: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(1, (cx - box.left) / box.width)),
    y: Math.max(0, Math.min(1, (cy - box.top) / box.height)),
  }
}

/** Drag start → normalized top-left, keeping the pointer's original offset
 * within the dragged rect (so grabbing off-center doesn't snap the corner
 * under the cursor). */
export function dragToPosition(
  box: PageBox,
  cx: number,
  cy: number,
  grabOffsetXPx: number,
  grabOffsetYPx: number,
  widthPx: number,
  heightPx: number,
): { x: number; y: number } {
  const left = cx - grabOffsetXPx
  const top = cy - grabOffsetYPx
  const maxLeft = box.width - widthPx
  const maxTop = box.height - heightPx
  const clampedLeft = Math.max(0, Math.min(maxLeft > 0 ? maxLeft : 0, left - box.left))
  const clampedTop = Math.max(0, Math.min(maxTop > 0 ? maxTop : 0, top - box.top))
  return {
    x: box.width > 0 ? clampedLeft / box.width : 0,
    y: box.height > 0 ? clampedTop / box.height : 0,
  }
}
