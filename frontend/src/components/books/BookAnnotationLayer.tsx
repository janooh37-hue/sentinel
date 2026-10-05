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

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronLeft, ChevronRight, Highlighter, MapPin, MessageSquare, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Hint } from '@/components/ui/hint'
import { cn } from '@/lib/utils'
import { useDeferredDelete } from '@/lib/useDeferredDelete'
import { useIsMobile } from '@/lib/useIsMobile'
import { useKeyboardInset } from '@/lib/useKeyboardInset'
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

/** A pointer that travels this far between down and up is a scroll / pinch, not a pin. */
const PIN_SLOP_PX = 8
export function BookAnnotationLayer({
  pages,
  annotations,
  mode,
  currentUserId,
  busy,
  armed = false,
  onCreate,
  onDelete,
  onDisarm,
  tool: toolProp,
  onToolChange,
  openId: openIdProp,
  onOpenIdChange,
}: {
  pages: PageBox[]
  annotations: BookAnnotation[]
  mode: 'view' | 'mark'
  currentUserId?: number
  busy?: boolean
  /** Mark mode only accepts touches while armed — disarmed, the paper keeps
   *  its native pinch-zoom and scroll. */
  armed?: boolean
  onCreate?: (m: {
    page: number
    kind: AnnotationKind
    geometry: Record<string, number>
    comment: string
  }) => void
  /** Called once the 6 s undo window has elapsed (or on unmount). */
  onDelete?: (id: number) => void
  /** Fired after a mark is saved or cancelled — one arm yields one mark. */
  onDisarm?: () => void
  /** Controlled tool. When `onToolChange` is given the host renders the tools
   *  itself (the desk toolbar, via `MarkTools`) and no floating toolbar shows. */
  tool?: AnnotationKind
  onToolChange?: (tool: AnnotationKind) => void
  /** Controlled open comment card (the toolbar's mark stepper drives it). */
  openId?: number | null
  onOpenIdChange?: (id: number | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  // Interaction is live only when the decider has explicitly armed marking.
  // Disarmed, the overlay must not intercept a single touch: the paper below
  // needs its native pinch-zoom and scroll back (the phone is the approval
  // surface, and an A4 page is unreadable at ~330px without zoom).
  const live = mode === 'mark' && armed
  const isPhone = useIsMobile()
  const keyboardInset = useKeyboardInset()
  const [toolState, setToolState] = useState<AnnotationKind>('pin')
  const tool = toolProp ?? toolState
  const noteReasonId = useId()
  const setTool = onToolChange ?? setToolState
  const [openIdState, setOpenIdState] = useState<number | null>(null)
  const openId = openIdProp !== undefined ? openIdProp : openIdState
  const setOpenId = onOpenIdChange ?? setOpenIdState
  const pinRef = useRef<{ page: number; x: number; y: number; clientX: number; clientY: number } | null>(null)

  // Undo-able delete: the mark hides at once, the request fires after 6 s unless undone.
  const { pendingIds, scheduleDelete } = useDeferredDelete<{ id: number }>({
    onCommit: (p) => onDelete?.(p.id),
    notify: ({ onUndo }) => {
      toast(t('books.annotations.deleted'), {
        duration: 6000,
        action: { label: t('common.undo'), onClick: onUndo },
      })
    },
  })

  // A stepper-driven card may sit off-screen: bring its badge into view.
  useEffect(() => {
    if (openId == null) return
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-mark-id="${openId}"]`)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [openId])
  const [draft, setDraft] = useState<DraftMark | null>(null)
  const [draftText, setDraftText] = useState('')
  const dragRef = useRef<{ page: number; x0: number; y0: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const draftBoxRef = useRef<HTMLTextAreaElement>(null)

  // Keyed off `live`, not `mode`: a disarm (armed -> false) must drop the
  // draft too, or the composer outlives the arm. Without this, tapping a
  // queue arrow while a draft is open leaves the composer mounted holding
  // the previous record's text/geometry, and Save writes it onto the new
  // record once its detail query is cached — a cross-record annotation.
  useEffect(() => {
    if (!live) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(null)
      setDraftText('')
      dragRef.current = null
    }
  }, [live])

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
      // Placed on pointerup: a touch that drifts (scroll / pinch) must not drop a pin.
      pinRef.current = { page: box.page, x: p.x, y: p.y, clientX: e.clientX, clientY: e.clientY }
    } else {
      dragRef.current = { page: box.page, x0: p.x, y0: p.y }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      setDraft({ page: box.page, kind: 'highlight', geometry: { x: p.x, y: p.y, w: 0, h: 0 } })
      setDraftText('')
    }
  }

  function onPointerMove(e: React.PointerEvent): void {
    const pin = pinRef.current
    if (pin && Math.hypot(e.clientX - pin.clientX, e.clientY - pin.clientY) >= PIN_SLOP_PX) {
      pinRef.current = null
    }
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
    const pin = pinRef.current
    if (pin) {
      pinRef.current = null
      if (Math.hypot(e.clientX - pin.clientX, e.clientY - pin.clientY) < PIN_SLOP_PX) {
        setDraft({ page: pin.page, kind: 'pin', geometry: { x: pin.x, y: pin.y } })
        setDraftText('')
      }
      return
    }
    if (!dragRef.current) return
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    setDraft((d) =>
      d && d.kind === 'highlight' && (d.geometry.w < 0.01 || d.geometry.h < 0.01) ? null : d,
    )
  }

  function onPointerCancel(): void {
    pinRef.current = null
  }

  /** Close the composer. Blur FIRST: iOS keeps the keyboard raised when a
   *  focused element simply unmounts, which left the manager with a keyboard
   *  and no box. */
  function closeDraft(): void {
    draftBoxRef.current?.blur()
    setDraft(null)
    setDraftText('')
    onDisarm?.()
  }

  function saveDraft(): void {
    if (!draft || !draftText.trim() || !onCreate) return
    onCreate({ page: draft.page, kind: draft.kind, geometry: draft.geometry, comment: draftText.trim() })
    closeDraft()
  }

  const numbered = annotations.map((a, i) => ({ a, n: i + 1 })).filter(({ a }) => !pendingIds.has(a.id))

  return (
    <div
      ref={rootRef}
      data-testid="anno-root"
      className={cn('absolute inset-0', live ? 'pointer-events-auto' : 'pointer-events-none')}
      onPointerDown={live ? onPointerDown : undefined}
      onPointerMove={live ? onPointerMove : undefined}
      onPointerUp={live ? onPointerUp : undefined}
      onPointerCancel={live ? onPointerCancel : undefined}
      // Only the highlight DRAG conflicts with the browser's own gestures, and
      // the browser commits to scroll-vs-gesture on pointerdown — so this keys
      // off the selected tool, not off a live drag (too late by then). Pin is
      // the default, so arming alone never costs the manager pinch-zoom.
      style={{ touchAction: live && tool === 'highlight' ? 'none' : undefined }}
    >
      {/* floating toolbar (mark mode) — only when the host does not render the tools itself */}
      {live && !onToolChange && (
        <div className="pointer-events-auto absolute left-1/2 top-2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border border-hairline bg-surface/95 px-2 py-1 shadow-lg backdrop-blur">
          <MarkTools tool={tool} onToolChange={setTool} />
        </div>
      )}

      {/* persisted marks */}
      {numbered.map(({ a, n }) => {
        const box = pages.find((p) => p.page === a.page)
        if (!box) return null
        const r = placeMark(box, a.geometry, a.kind)
        const open = openId === a.id
        // Optimistic marks (id <= 0) have no server row yet: nothing to delete.
        const canDelete = live && a.author_user_id === currentUserId && onDelete != null && a.id > 0
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
              data-mark-id={a.id}
              onClick={() => setOpenId(open ? null : a.id)}
              className="pointer-events-auto absolute z-20 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-surface bg-warning text-[0.7em] font-bold text-warning-foreground shadow-md before:absolute before:-inset-3 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                        scheduleDelete({ id: a.id })
                        setOpenId(null)
                      }}
                      className="ms-auto rounded-md p-1 text-muted-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none max-md:p-3"
                      aria-label={t('books.annotations.delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
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
                testId="anno-composer"
                composer
                onKeyDown={(e) => {
                  // Esc closes the composer locally from any control inside it
                  // (textarea, Cancel, Save, padding); the page-level Esc (back / focus) must not also fire.
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    e.stopPropagation()
                    closeDraft()
                  }
                }}
                sheetBottom={isPhone ? keyboardInset : undefined}
                className={cn(
                  'rounded-xl border border-hairline bg-surface p-3 shadow-2xl',
                  isPhone ? 'w-auto' : 'w-[224px]',
                )}
              >
                <textarea
                  ref={draftBoxRef}
                  autoFocus={!isPhone}
                  rows={2}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder={t('books.annotations.composerPlaceholder')}
                  className="w-full rounded-md border border-hairline bg-background px-2 py-1.5 text-[0.74em] text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
                <div className="mt-2 flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={closeDraft}
                    className="rounded-md px-2 py-1 text-[0.7em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted motion-reduce:transition-none max-md:min-h-11 max-md:px-3"
                  >
                    {t('books.annotations.cancel')}
                  </button>
                  {(() => {
                    const empty = !draftText.trim()
                    const save = (
                      <button
                        type="button"
                        disabled={busy}
                        aria-disabled={empty || undefined}
                        aria-describedby={empty ? noteReasonId : undefined}
                        onClick={empty ? undefined : saveDraft}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md bg-warning px-2.5 py-1 text-[0.7em] font-semibold text-warning-foreground transition-colors hover:bg-warning/90 disabled:opacity-50 motion-reduce:transition-none max-md:min-h-11 max-md:px-3',
                          empty && 'opacity-50',
                        )}
                      >
                        <Check className="h-3 w-3" strokeWidth={2.6} aria-hidden /> {t('books.annotations.save')}
                      </button>
                    )
                    return empty && !isPhone ? <Hint label={t('books.reason.noteEmpty')}>{save}</Hint> : save
                  })()}
                </div>
                {!draftText.trim() && (
                  // The reason is always in the DOM for assistive tech; visible on touch, where a tooltip cannot show.
                  <p
                    id={noteReasonId}
                    className={cn('mt-1.5 text-end text-[0.64em] text-muted-foreground', !isPhone && 'sr-only')}
                  >
                    {t('books.reason.noteEmpty')}
                  </p>
                )}
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
  /** Phone: ignore the anchor and pin to the bottom, clear of the keyboard. */
  sheetBottom,
  testId,
  composer,
  onKeyDown,
  children,
}: {
  rootRef: React.RefObject<HTMLDivElement | null>
  anchorLeft: number
  anchorTop: number
  className?: string
  dir?: 'auto' | 'ltr' | 'rtl'
  sheetBottom?: number
  testId?: string
  /** The draft composer: tagged so the shortcuts layer treats it as an overlay. */
  composer?: boolean
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
  children: React.ReactNode
}): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null)

  // Position imperatively (no render state) so we can re-place on every scroll /
  // resize / content-size change without cascading renders. useLayoutEffect runs
  // before paint, so the first placement lands without a flash.
  useLayoutEffect(() => {
    const place = (): void => {
      if (sheetBottom != null) return
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
  }, [anchorLeft, anchorTop, rootRef, sheetBottom])

  return createPortal(
    <div
      ref={cardRef}
      dir={dir}
      data-anno-ui
      data-testid={testId}
      data-anno-composer={composer ? '' : undefined}
      onKeyDown={onKeyDown}
      className={cn(
        'pointer-events-auto fixed z-[70]',
        sheetBottom != null ? 'inset-x-2' : 'left-0 top-0',
        className,
        // Closed-keyboard is bottom:0 (sheetBottom is 0, and 0 != null) — the
        // state the composer opens in on every phone, since autoFocus is
        // desktop-only. --safe-bottom carries the 0px fallback (index.css); max() keeps the sheet's own padding on inset-less devices.
        sheetBottom != null && 'pb-[max(0.75rem,var(--safe-bottom))]',
      )}
      style={sheetBottom != null ? { bottom: `${sheetBottom}px` } : undefined}
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
    <Hint label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none max-md:h-11 max-md:w-11',
          active ? 'bg-warning/15 text-warning' : 'text-muted-foreground hover:bg-surface-tinted',
        )}
      >
        {icon}
      </button>
    </Hint>
  )
}

/**
 * The Pin / Highlight tools plus their one-line hint. Rendered by the desk
 * toolbar while marking is armed (and by the layer's own floating toolbar when
 * the host does not take over).
 */
export function MarkTools({
  tool,
  onToolChange,
}: {
  tool: AnnotationKind
  onToolChange: (tool: AnnotationKind) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div role="group" aria-label={t('books.annotations.mark')} className="flex items-center gap-1">
      <ToolBtn
        active={tool === 'pin'}
        onClick={() => onToolChange('pin')}
        icon={<MapPin className="h-3.5 w-3.5" aria-hidden />}
        label={t('books.annotations.pin')}
      />
      <ToolBtn
        active={tool === 'highlight'}
        onClick={() => onToolChange('highlight')}
        icon={<Highlighter className="h-3.5 w-3.5" aria-hidden />}
        label={t('books.annotations.highlight')}
      />
      <span className="mx-1 h-4 w-px bg-hairline" aria-hidden />
      <span className="pe-1 text-[0.75em] font-medium text-muted-foreground max-md:hidden">
        {t('books.annotations.hint')}
      </span>
    </div>
  )
}

/**
 * "{{count}} marks from {{name}}" with previous / next stepping. The current
 * mark's card opens (`openId`) and its badge scrolls into view.
 */
export function MarksStepper({
  annotations,
  openId,
  onOpenIdChange,
}: {
  annotations: BookAnnotation[]
  openId: number | null
  onOpenIdChange: (id: number | null) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (annotations.length === 0) return null
  const index = annotations.findIndex((a) => a.id === openId)
  const step = (dir: 1 | -1): void => {
    const next = index === -1 ? (dir === 1 ? 0 : annotations.length - 1) : (index + dir + annotations.length) % annotations.length
    onOpenIdChange(annotations[next].id)
  }
  // Isolate the name so an Arabic name inside an English sentence (and vice versa) keeps its order.
  const name = `\u2068${annotations[0].author_name ?? '—'}\u2069`
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 ps-3 pe-0.5 text-[0.75em] font-semibold text-accent">
      <MessageSquare className="h-3.5 w-3.5" aria-hidden />
      <span role="status">{t('books.paper.marksFrom', { count: annotations.length, name })}</span>
      <button
        type="button"
        aria-label={t('common.previous')}
        onClick={() => step(-1)}
        className="grid h-8 w-8 place-items-center rounded-full hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-11 max-md:w-11"
      >
        <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={t('common.next')}
        onClick={() => step(1)}
        className="grid h-8 w-8 place-items-center rounded-full hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-11 max-md:w-11"
      >
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
      </button>
    </span>
  )
}
