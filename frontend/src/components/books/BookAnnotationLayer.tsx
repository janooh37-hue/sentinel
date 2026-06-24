/**
 * BookAnnotationLayer — overlay on the record-screen PDF reader.
 *
 * `view` (read-only): renders persisted pins + highlights with their comments;
 *   click a numbered badge to open/close its comment card. Shown to the submitter
 *   on a returned/rejected book.
 * `mark` (the assigned signer, pending): Pin / Highlight tools → click (pin) or
 *   drag (highlight) on a page → comment composer → create. Author can delete own.
 *
 * Placement math is physical (page-relative 0–1, see annotation-utils) so marks
 * survive reflow/DPR; RTL only affects chrome here, never the coordinates.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, Highlighter, MapPin, Trash2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  normalizePoint,
  pageAtPoint,
  placeMark,
  type AnnotationKind,
  type BookAnnotation,
  type PageBox,
} from './annotation-utils'

interface DraftMark {
  page: number
  kind: AnnotationKind
  geometry: Record<string, number>
}

export function BookAnnotationLayer({
  pages,
  annotations,
  mode,
  currentUserId,
  busy,
  onCreate,
  onDelete,
}: {
  pages: PageBox[]
  annotations: BookAnnotation[]
  mode: 'view' | 'mark'
  currentUserId?: number
  busy?: boolean
  onCreate?: (m: {
    page: number
    kind: AnnotationKind
    geometry: Record<string, number>
    comment: string
  }) => void
  onDelete?: (id: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [tool, setTool] = useState<AnnotationKind>('pin')
  const [openId, setOpenId] = useState<number | null>(null)
  const [draft, setDraft] = useState<DraftMark | null>(null)
  const [draftText, setDraftText] = useState('')
  const dragRef = useRef<{ page: number; x0: number; y0: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mode !== 'mark') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(null)
      setDraftText('')
      dragRef.current = null
    }
  }, [mode])

  function contentPoint(e: React.PointerEvent): { cx: number; cy: number } {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { cx: e.clientX - r.left, cy: e.clientY - r.top }
  }

  function onPointerDown(e: React.PointerEvent): void {
    if (mode !== 'mark' || draft || busy) return
    // Ignore pointerdowns landing on an existing mark's badge/card or the
    // composer — otherwise the overlay starts a brand-new mark instead of
    // letting the badge click open its comment card.
    if ((e.target as HTMLElement).closest('[data-anno-ui]')) return
    const { cx, cy } = contentPoint(e)
    const box = pageAtPoint(pages, cx, cy)
    if (!box) return
    const p = normalizePoint(box, cx, cy)
    if (tool === 'pin') {
      setDraft({ page: box.page, kind: 'pin', geometry: { x: p.x, y: p.y } })
      setDraftText('')
    } else {
      dragRef.current = { page: box.page, x0: p.x, y0: p.y }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      setDraft({ page: box.page, kind: 'highlight', geometry: { x: p.x, y: p.y, w: 0, h: 0 } })
      setDraftText('')
    }
  }

  function onPointerMove(e: React.PointerEvent): void {
    const d = dragRef.current
    if (!d || tool !== 'highlight') return
    const box = pages.find((p) => p.page === d.page)
    if (!box) return
    const { cx, cy } = contentPoint(e)
    const cur = normalizePoint(box, cx, cy)
    setDraft({
      page: d.page,
      kind: 'highlight',
      geometry: {
        x: Math.min(d.x0, cur.x),
        y: Math.min(d.y0, cur.y),
        w: Math.abs(cur.x - d.x0),
        h: Math.abs(cur.y - d.y0),
      },
    })
  }

  function onPointerUp(e: React.PointerEvent): void {
    if (!dragRef.current) return
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    setDraft((d) =>
      d && d.kind === 'highlight' && (d.geometry.w < 0.01 || d.geometry.h < 0.01) ? null : d,
    )
  }

  function saveDraft(): void {
    if (!draft || !draftText.trim() || !onCreate) return
    onCreate({ page: draft.page, kind: draft.kind, geometry: draft.geometry, comment: draftText.trim() })
    setDraft(null)
    setDraftText('')
  }

  const numbered = annotations.map((a, i) => ({ a, n: i + 1 }))

  return (
    <div
      ref={rootRef}
      className={cn('absolute inset-0', mode === 'mark' ? 'pointer-events-auto' : 'pointer-events-none')}
      onPointerDown={mode === 'mark' ? onPointerDown : undefined}
      onPointerMove={mode === 'mark' ? onPointerMove : undefined}
      onPointerUp={mode === 'mark' ? onPointerUp : undefined}
      style={{ touchAction: mode === 'mark' ? 'none' : undefined }}
    >
      {/* toolbar (mark mode) */}
      {mode === 'mark' && (
        <div className="pointer-events-auto absolute left-1/2 top-2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border border-hairline bg-surface/95 px-2 py-1 shadow-lg backdrop-blur">
          <ToolBtn
            active={tool === 'pin'}
            onClick={() => setTool('pin')}
            icon={<MapPin className="h-3.5 w-3.5" />}
            label={t('books.annotations.pin')}
          />
          <ToolBtn
            active={tool === 'highlight'}
            onClick={() => setTool('highlight')}
            icon={<Highlighter className="h-3.5 w-3.5" />}
            label={t('books.annotations.highlight')}
          />
          <span className="mx-1 h-4 w-px bg-hairline" />
          <span className="pe-1 text-[0.64em] font-medium text-muted-foreground">
            {t('books.annotations.hint')}
          </span>
        </div>
      )}

      {/* persisted marks */}
      {numbered.map(({ a, n }) => {
        const box = pages.find((p) => p.page === a.page)
        if (!box) return null
        const r = placeMark(box, a.geometry, a.kind)
        const open = openId === a.id
        const canDelete = mode === 'mark' && a.author_user_id === currentUserId && onDelete != null
        return (
          <div key={a.id}>
            {a.kind === 'highlight' && (
              <div
                className="pointer-events-none absolute z-10 rounded-sm"
                style={{
                  left: r.left,
                  top: r.top,
                  width: r.width,
                  height: r.height,
                  background: 'color-mix(in srgb, var(--warning) 26%, transparent)',
                  boxShadow: '0 0 0 1px color-mix(in srgb, var(--warning) 45%, transparent)',
                }}
              />
            )}
            <button
              type="button"
              data-anno-ui
              onClick={() => setOpenId(open ? null : a.id)}
              className="pointer-events-auto absolute z-20 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-surface bg-warning text-[0.7em] font-bold text-warning-foreground shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ left: r.left, top: r.top }}
              aria-label={t('books.annotations.markN', { n })}
            >
              {n}
            </button>
            {open && (
              <MarkPopover
                rootRef={rootRef}
                anchorLeft={r.left}
                anchorTop={r.top + 16}
                dir="auto"
                className="w-[212px] rounded-xl border border-hairline bg-surface p-3 shadow-xl"
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-warning text-[0.58em] font-bold text-warning-foreground">
                    {n}
                  </span>
                  <span className="truncate text-[0.72em] font-semibold text-foreground">
                    {a.author_name ?? '—'}
                  </span>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => {
                        onDelete?.(a.id)
                        setOpenId(null)
                      }}
                      className="ms-auto text-muted-foreground transition-colors hover:text-accent"
                      aria-label={t('books.annotations.delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p className="text-[0.72em] leading-snug text-foreground">{a.comment}</p>
                {mode === 'view' && (
                  <div className="mt-1.5 text-[0.64em] text-muted-foreground">
                    {t('books.annotations.viewHint')}
                  </div>
                )}
              </MarkPopover>
            )}
          </div>
        )
      })}

      {/* draft (mark mode, mid-create) */}
      {draft &&
        (() => {
          const box = pages.find((p) => p.page === draft.page)
          if (!box) return null
          const r = placeMark(box, draft.geometry, draft.kind)
          const top = draft.kind === 'highlight' ? r.top + r.height : r.top
          return (
            <>
              {draft.kind === 'highlight' && (
                <div
                  className="pointer-events-none absolute z-10 rounded-sm"
                  style={{
                    left: r.left,
                    top: r.top,
                    width: r.width,
                    height: r.height,
                    background: 'color-mix(in srgb, var(--warning) 20%, transparent)',
                    boxShadow: '0 0 0 1px color-mix(in srgb, var(--warning) 50%, transparent)',
                  }}
                />
              )}
              <MarkPopover
                rootRef={rootRef}
                anchorLeft={r.left}
                anchorTop={top + 8}
                dir="auto"
                className="w-[224px] rounded-xl border border-hairline bg-surface p-3 shadow-2xl"
              >
                <textarea
                  autoFocus
                  rows={2}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder={t('books.annotations.composerPlaceholder')}
                  className="w-full rounded-md border border-hairline bg-background px-2 py-1.5 text-[0.74em] text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
                <div className="mt-2 flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(null)
                      setDraftText('')
                    }}
                    className="rounded-md px-2 py-1 text-[0.7em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted"
                  >
                    {t('books.annotations.cancel')}
                  </button>
                  <button
                    type="button"
                    disabled={!draftText.trim() || busy}
                    onClick={saveDraft}
                    className="inline-flex items-center gap-1 rounded-md bg-warning px-2.5 py-1 text-[0.7em] font-semibold text-warning-foreground transition-colors hover:bg-warning/90 disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" strokeWidth={2.6} /> {t('books.annotations.save')}
                  </button>
                </div>
              </MarkPopover>
            </>
          )
        })()}
    </div>
  )
}

/**
 * MarkPopover — renders a mark's floating card (open comment / draft composer)
 * in a portal at the document root with `position: fixed`, anchored to the
 * mark's live screen position and clamped to the viewport.
 *
 * Why a portal: the cards used to be `position:absolute` inside the PDF scroll
 * container (`overflow:auto`), so a mark near the page edge — or on a narrow /
 * zoomed desk — pushed the card past the scroll box and it got clipped ("typed
 * behind the page"). A fixed, body-portaled card escapes every `overflow` and
 * stacking-context ancestor, then clamps so it always stays fully on-screen.
 *
 * `anchorLeft`/`anchorTop` are in the overlay's content space (same coords as
 * the badge); we add the overlay's live bounding-rect origin to map them to
 * screen px, recomputing on scroll/resize so the card tracks the page.
 */
function MarkPopover({
  rootRef,
  anchorLeft,
  anchorTop,
  className,
  dir,
  children,
}: {
  rootRef: React.RefObject<HTMLDivElement | null>
  anchorLeft: number
  anchorTop: number
  className?: string
  dir?: 'auto' | 'ltr' | 'rtl'
  children: React.ReactNode
}): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null)

  // Position imperatively (no render state) so we can re-place on every scroll /
  // resize / content-size change without cascading renders. useLayoutEffect runs
  // before paint, so the first placement lands without a flash.
  useLayoutEffect(() => {
    const place = (): void => {
      const card = cardRef.current
      const root = rootRef.current
      if (!card || !root) return
      const rect = root.getBoundingClientRect()
      const w = card.offsetWidth
      const h = card.offsetHeight
      const margin = 8
      const vw = window.innerWidth
      const vh = window.innerHeight
      // Anchor centre → clamp so the whole card stays on-screen horizontally.
      let left = rect.left + anchorLeft - w / 2
      left = Math.min(Math.max(left, margin), Math.max(margin, vw - w - margin))
      // Below the anchor by default; flip above if it would overflow the bottom.
      let top = rect.top + anchorTop
      if (top + h > vh - margin) {
        const flipped = rect.top + anchorTop - h - 24
        top = flipped > margin ? flipped : Math.max(margin, vh - h - margin)
      }
      card.style.left = `${left}px`
      card.style.top = `${top}px`
    }
    place()
    // capture:true so scrolls on the inner desk container reach us too.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    const ro = new ResizeObserver(place)
    if (cardRef.current) ro.observe(cardRef.current)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      ro.disconnect()
    }
  }, [anchorLeft, anchorTop, rootRef])

  return createPortal(
    <div
      ref={cardRef}
      dir={dir}
      data-anno-ui
      className={cn('pointer-events-auto fixed left-0 top-0 z-[70]', className)}
    >
      {children}
    </div>,
    document.body,
  )
}

function ToolBtn({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick?: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
        active ? 'bg-warning/15 text-warning' : 'text-muted-foreground hover:bg-surface-tinted',
      )}
    >
      {icon}
    </button>
  )
}
