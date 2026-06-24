/**
 * Pure helpers for the book PDF annotation overlay. Kept in a non-component file
 * so they're unit-testable and don't trip the shadcn/react-refresh export rule.
 *
 * Coordinates are PHYSICAL (page-relative, normalized 0–1) so marks survive
 * zoom/DPR/reflow; RTL only affects chrome in the component, never this math.
 */

export interface PageBox {
  /** 1-based page number. */
  page: number
  /** Offset of the page's rendered canvas within the overlay, in CSS px. */
  left: number
  top: number
  width: number
  height: number
}

export type AnnotationKind = 'pin' | 'highlight'

export interface BookAnnotation {
  id: number
  version_id: number
  page: number
  kind: AnnotationKind
  geometry: Record<string, number>
  comment: string | null
  author_user_id: number | null
  author_name: string | null
  created_at: string
}

export interface MarkRect {
  left: number
  top: number
  width: number
  height: number
}

/** Map a normalized annotation onto its page box → absolute px within the overlay. */
export function placeMark(
  box: PageBox,
  geometry: Record<string, number>,
  kind: AnnotationKind,
): MarkRect {
  const x = geometry.x ?? 0
  const y = geometry.y ?? 0
  const left = box.left + x * box.width
  const top = box.top + y * box.height
  if (kind === 'highlight') {
    return { left, top, width: (geometry.w ?? 0) * box.width, height: (geometry.h ?? 0) * box.height }
  }
  return { left, top, width: 0, height: 0 }
}

/** True if any annotation carries a non-blank comment (satisfies the return reason rule). */
export function hasCommentBearingMark(annotations: BookAnnotation[]): boolean {
  return annotations.some((a) => a.comment != null && a.comment.trim().length > 0)
}

/** The page box containing a content-space point (px), or null. */
export function pageAtPoint(pages: PageBox[], cx: number, cy: number): PageBox | null {
  return (
    pages.find(
      (p) => cx >= p.left && cx <= p.left + p.width && cy >= p.top && cy <= p.top + p.height,
    ) ?? null
  )
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** Normalize a content-space point to 0–1 within a page box (clamped). */
export function normalizePoint(box: PageBox, cx: number, cy: number): { x: number; y: number } {
  return { x: clamp01((cx - box.left) / box.width), y: clamp01((cy - box.top) / box.height) }
}
