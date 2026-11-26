/**
 * The profile ID card's photo tile, enlarged on demand so the operator can see
 * the person's face.
 *
 * Two surfaces, one source image (the tile's own `/photo?v=` URL, already
 * cached; the stored photo is the original upload, so it stays sharp):
 *
 * - **Peek** — a mouse pointer resting on the tile (hover intent) or keyboard
 *   focus. A non-modal enlargement that grows out of the tile into the space
 *   beside it (or below it, when that has more room). It never overlaps the
 *   tile, so the camera button on the tile's corner stays reachable. The
 *   pointer may cross onto the peek and stay there (a click on it opens the
 *   full view); it shrinks back into the tile once the pointer has left both
 *   for a short grace delay, and on blur, Escape or scroll. It is a visual
 *   duplicate of the tile, so `aria-hidden`.
 * - **Full view** — a click, Enter or a tap (touch has no hover). A modal
 *   `DialogContent` that grows from wherever the photo is on screen (the peek
 *   when it is showing, else the tile) to a centred, larger frame. Escape, a
 *   tap outside or the close control dismisses it.
 *
 * Both growths are one FLIP transform from the source rectangle, skipped under
 * `prefers-reduced-motion` (show/hide only). The camera upload button is a
 * sibling of this tile, not a child, so its click never reaches it.
 */

import { X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { useReducedMotion } from '@/lib/useFakeProgress'
import { cn } from '@/lib/utils'

/** Hover intent: a pointer crossing the tile on its way elsewhere opens nothing. */
const HOVER_INTENT_MS = 120
const EASE_OUT_EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)'
/** Peek photo box: 4:5, the ID-photo shape, 4.5x the 80px tile; the photo is fitted inside it. */
const PEEK_MAX = { width: 360, height: 450 }
/** Lift of the peek's top edge above the tile's top edge. */
const PEEK_LIFT = 12
/** Clear space between the tile (with the camera on its corner) and the peek. */
const PEEK_GAP = 12
/** Pointer crossing the gap between tile and peek: closing waits this long. */
const PEEK_GRACE_MS = 120
const VIEWPORT_MARGIN = 12
/** Peek frame around the photo: p-1.5 + 1px border on each side. */
const FRAME_X = 14
/** The same, plus a caption of up to two name lines and the ID. */
const FRAME_Y = 14 + 72

interface Props {
  src: string
  /** Display-language name: the tile's label and the full view's title. */
  name: string
  altName: string | null
  employeeId: string
}

interface Size {
  width: number
  height: number
}

/** The largest box of the photo's aspect that fits `max` (a square until it loads). */
function fitPhoto(natural: Size | null, max: Size): Size {
  const ratio = natural && natural.width > 0 && natural.height > 0 ? natural.width / natural.height : 1
  const width = Math.max(0, Math.min(max.width, max.height * ratio))
  return { width: Math.round(width), height: Math.round(width / ratio) }
}

/** Motion runs only where the user allows it and the browser has the Web Animations API. */
function canAnimate(reducedMotion: boolean): boolean {
  return !reducedMotion && typeof Element.prototype.animate === 'function'
}

/**
 * FLIP: start `frame` so that its `img` sits exactly on `from`, then let it
 * settle where layout put it (or, `reverse`, travel back onto `from`). With no
 * laid-out image (a failed load) it only fades.
 */
function growFrom(
  frame: HTMLElement,
  from: DOMRect,
  options: { duration: number; reverse?: boolean },
): Animation {
  const f = frame.getBoundingClientRect()
  const i = frame.querySelector('img')?.getBoundingClientRect()
  let start: Keyframe = { opacity: 0 }
  if (i && i.width > 0 && i.height > 0) {
    // The tile crops the photo (object-cover); scale so the photo covers the
    // source box, centred on it, as the tile shows it.
    const scale = Math.max(from.width / i.width, from.height / i.height)
    const x = from.left + (from.width - i.width * scale) / 2 - i.left
    const y = from.top + (from.height - i.height * scale) / 2 - i.top
    frame.style.transformOrigin = `${i.left - f.left}px ${i.top - f.top}px`
    start = { transform: `translate(${x}px, ${y}px) scale(${scale})`, opacity: 0 }
  }
  return frame.animate([start, { opacity: 1, offset: 0.3 }, { transform: 'none', opacity: 1 }], {
    duration: options.duration,
    easing: EASE_OUT_EXPO,
    direction: options.reverse ? 'reverse' : 'normal',
    fill: 'both',
  })
}

/**
 * Where the peek frame sits and how large its photo is. It never overlaps the
 * tile: it goes beside it on the inline-end side (right in LTR, left in RTL),
 * top lifted a little above the tile's, or below the tile when that region
 * fits a larger photo. Derived on every render, so the frame stays anchored
 * when the photo's aspect arrives late.
 */
function placePeek(
  tile: DOMRect,
  rtl: boolean,
  natural: Size | null,
): { left: number; top: number; photo: Size } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clamp = (value: number, room: number): number =>
    Math.max(VIEWPORT_MARGIN, Math.min(value, room - VIEWPORT_MARGIN))
  const besideRoom = rtl
    ? tile.left - PEEK_GAP - VIEWPORT_MARGIN
    : vw - VIEWPORT_MARGIN - (tile.right + PEEK_GAP)
  const beside = fitPhoto(natural, {
    width: Math.min(PEEK_MAX.width, besideRoom - FRAME_X),
    height: Math.min(PEEK_MAX.height, vh - 2 * VIEWPORT_MARGIN - FRAME_Y),
  })
  const below = fitPhoto(natural, {
    width: Math.min(PEEK_MAX.width, vw - 2 * VIEWPORT_MARGIN - FRAME_X),
    height: Math.min(PEEK_MAX.height, vh - VIEWPORT_MARGIN - (tile.bottom + PEEK_GAP) - FRAME_Y),
  })
  if (beside.width >= below.width) {
    return {
      photo: beside,
      left: rtl ? tile.left - PEEK_GAP - (beside.width + FRAME_X) : tile.right + PEEK_GAP,
      top: clamp(tile.top - PEEK_LIFT, vh - (beside.height + FRAME_Y)),
    }
  }
  const frameWidth = below.width + FRAME_X
  return {
    photo: below,
    left: clamp(rtl ? tile.right + PEEK_LIFT - frameWidth : tile.left - PEEK_LIFT, vw - frameWidth),
    top: tile.bottom + PEEK_GAP,
  }
}

export function EmployeePhotoPreview({ src, name, altName, employeeId }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const tileRef = useRef<HTMLButtonElement>(null)
  const peekRef = useRef<HTMLDivElement>(null)
  const intentTimer = useRef<number | undefined>(undefined)
  /** Grace before the peek closes once the pointer has left both tile and peek. */
  const graceTimer = useRef<number | undefined>(undefined)
  /** Focus that a pointer press or the dialog's focus return caused shows no peek. */
  const skipFocusPeek = useRef(false)
  const [natural, setNatural] = useState<Size | null>(null)
  /** `closing` keeps the peek mounted while it shrinks back into the tile. */
  const [peek, setPeek] = useState<'closed' | 'open' | 'closing'>('closed')
  /** The tile's box and direction when the peek opened; placement derives from it. */
  const [peekAnchor, setPeekAnchor] = useState<{ tile: DOMRect; rtl: boolean } | null>(null)
  const [fullFrom, setFullFrom] = useState<DOMRect | null>(null)

  const peekPlace = peekAnchor && placePeek(peekAnchor.tile, peekAnchor.rtl, natural)

  function openPeek(): void {
    window.clearTimeout(intentTimer.current)
    const tile = tileRef.current
    if (!tile || fullFrom) return
    setPeekAnchor({
      tile: tile.getBoundingClientRect(),
      rtl: getComputedStyle(tile).direction === 'rtl',
    })
    setPeek('open')
  }

  const closePeek = useCallback((): void => {
    window.clearTimeout(intentTimer.current)
    window.clearTimeout(graceTimer.current)
    const next = canAnimate(reducedMotion) ? 'closing' : 'closed'
    setPeek((state) => (state === 'open' ? next : state))
  }, [reducedMotion])

  /** The pointer left the tile or the peek: close unless it lands on the other. */
  function closeAfterGrace(): void {
    window.clearTimeout(intentTimer.current)
    window.clearTimeout(graceTimer.current)
    graceTimer.current = window.setTimeout(closePeek, PEEK_GRACE_MS)
  }

  // Grow the peek out of the tile on open; shrink it back on close. While it
  // grows it still overlaps the tile, so it takes the pointer only once settled.
  useLayoutEffect(() => {
    const frame = peekRef.current
    const tile = tileRef.current
    if (peek === 'closed' || !frame || !tile || !canAnimate(reducedMotion)) return
    const animation = growFrom(frame, tile.getBoundingClientRect(), {
      duration: peek === 'open' ? 220 : 150,
      reverse: peek === 'closing',
    })
    if (peek === 'closing') {
      animation.onfinish = () => setPeek('closed')
    } else {
      frame.style.pointerEvents = 'none'
      animation.onfinish = () => {
        frame.style.pointerEvents = ''
      }
    }
    return () => animation.cancel()
  }, [peek, reducedMotion])

  // While the peek shows: Escape closes it, and a scroll or resize would leave
  // it floating away from its tile, so those close it too.
  useEffect(() => {
    if (peek !== 'open') return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closePeek()
    }
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', closePeek, true)
    window.addEventListener('resize', closePeek)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', closePeek, true)
      window.removeEventListener('resize', closePeek)
    }
  }, [peek, closePeek])

  useEffect(
    () => () => {
      window.clearTimeout(intentTimer.current)
      window.clearTimeout(graceTimer.current)
    },
    [],
  )

  /**
   * Grow the full view from wherever the photo was when it was asked for. A ref
   * callback, not a layout effect: Radix's portal mounts the dialog one pass
   * after `open` flips, and the image is the first moment it is laid out.
   */
  const growFullView = useCallback(
    (img: HTMLImageElement | null) => {
      const frame = img?.closest<HTMLElement>('[role="dialog"]')
      if (!frame || !fullFrom || !canAnimate(reducedMotion)) return
      const animation = growFrom(frame, fullFrom, { duration: 300 })
      animation.onfinish = () => {
        animation.cancel()
        frame.style.transformOrigin = ''
      }
      return () => animation.cancel()
    },
    [fullFrom, reducedMotion],
  )

  function openFull(): void {
    const source = peekRef.current?.querySelector('img') ?? tileRef.current
    if (!source) return
    window.clearTimeout(intentTimer.current)
    window.clearTimeout(graceTimer.current)
    skipFocusPeek.current = false
    setFullFrom(source.getBoundingClientRect())
    setPeek('closed')
  }

  const fullMax = {
    width: Math.min(560, window.innerWidth - 48),
    height: Math.min(640, window.innerHeight - 160),
  }
  const fullBox = fitPhoto(natural, fullMax)

  return (
    <>
      <button
        ref={tileRef}
        type="button"
        aria-label={t('employees.photo.view', { name })}
        className="block cursor-zoom-in rounded-[14px] focus-visible:outline-white"
        onPointerEnter={(event) => {
          if (event.pointerType === 'touch') return
          window.clearTimeout(graceTimer.current)
          if (peek === 'open') return
          window.clearTimeout(intentTimer.current)
          intentTimer.current = window.setTimeout(openPeek, HOVER_INTENT_MS)
        }}
        onPointerLeave={closeAfterGrace}
        onPointerDown={() => {
          skipFocusPeek.current = true
        }}
        onFocus={() => {
          if (skipFocusPeek.current) skipFocusPeek.current = false
          else openPeek()
        }}
        onBlur={closePeek}
        onClick={openFull}
      >
        <img
          src={src}
          alt=""
          onLoad={(event) => {
            const img = event.currentTarget
            setNatural({ width: img.naturalWidth, height: img.naturalHeight })
          }}
          onError={(event) => {
            event.currentTarget.style.visibility = 'hidden'
          }}
          className="h-20 w-20 rounded-[14px] object-cover ring-2 ring-white/20"
        />
      </button>

      {peek !== 'closed' &&
        peekPlace &&
        createPortal(
          <div
            ref={peekRef}
            data-photo-peek
            aria-hidden
            className={cn(
              'fixed z-50 cursor-zoom-in rounded-2xl border border-hairline bg-surface p-1.5 shadow-xl',
              // Only the settled peek takes the pointer; a shrinking one lets it through.
              peek !== 'open' && 'pointer-events-none',
            )}
            style={{ left: peekPlace.left, top: peekPlace.top }}
            onPointerEnter={() => window.clearTimeout(graceTimer.current)}
            onPointerLeave={closeAfterGrace}
            // Keep focus where it is: a focused tile's blur would close the
            // peek before this click lands.
            onMouseDown={(event) => event.preventDefault()}
            onClick={openFull}
          >
            <img
              src={src}
              alt=""
              width={peekPlace.photo.width}
              height={peekPlace.photo.height}
              className="block rounded-[12px] object-cover"
              style={{ width: peekPlace.photo.width, height: peekPlace.photo.height }}
            />
            <div className="px-1.5 pb-1 pt-2 text-start" style={{ width: peekPlace.photo.width }}>
              <div className="line-clamp-2 text-[0.85em] font-semibold leading-snug text-foreground">
                <bdi>{name}</bdi>
              </div>
              {/* `font-mono` sits on the <bdi>: `:lang(ar)` sets the Arabic face on
                  every element of an Arabic page, so the inherited one would lose. */}
              <div className="text-[0.75em] text-muted-foreground">
                <bdi dir="ltr" className="font-mono">
                  {employeeId}
                </bdi>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <DialogRoot
        open={fullFrom !== null}
        onOpenChange={(open) => {
          if (open) return
          skipFocusPeek.current = true
          setFullFrom(null)
        }}
      >
        {/* The shared dialog's zoom-in entrance outranks its own motion-reduce
            guard (attribute variant); under reduced motion this view only appears. */}
        <DialogContent
          hideClose
          returnFocusRef={tileRef}
          className="w-auto max-w-none p-2 motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none"
        >
          <img
            ref={growFullView}
            src={src}
            alt={name}
            width={fullBox.width}
            height={fullBox.height}
            className="block rounded-[12px] object-cover"
            style={{ width: fullBox.width, height: fullBox.height }}
          />
          <div className="flex items-start gap-3 px-1.5 pb-1 pt-2.5" style={{ width: fullBox.width }}>
            <div className="min-w-0 flex-1 text-start">
              <DialogTitle className="line-clamp-2 text-[0.95em] leading-snug">
                <bdi>{name}</bdi>
              </DialogTitle>
              {altName && (
                <bdi className="inline-block max-w-full truncate align-bottom text-[0.8em] text-muted-foreground">
                  {altName}
                </bdi>
              )}
              <DialogDescription className="text-[0.75em]">
                <bdi dir="ltr" className="font-mono">
                  {employeeId}
                </bdi>
              </DialogDescription>
            </div>
            <DialogClose
              aria-label={t('common.close')}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground pointer-coarse:h-11 pointer-coarse:w-11"
            >
              <X className="h-4 w-4" aria-hidden />
            </DialogClose>
          </div>
        </DialogContent>
      </DialogRoot>
    </>
  )
}
