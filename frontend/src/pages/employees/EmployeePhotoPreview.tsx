/**
 * The profile ID card's photo tile, enlarged on demand so the operator can see
 * the person's face.
 *
 * Two surfaces, one source image (the tile's own `/photo?v=` URL, already
 * cached; the stored photo is the original upload, so it stays sharp):
 *
 * - **Peek** — a mouse pointer resting on the tile (hover intent) or keyboard
 *   focus. A non-modal, `pointer-events-none` enlargement that grows out of the
 *   tile, anchored at its corner, and shrinks back into it on leave, blur,
 *   Escape or scroll. It is a visual duplicate of the tile, so `aria-hidden`.
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

/** Hover intent: a pointer crossing the tile on its way elsewhere opens nothing. */
const HOVER_INTENT_MS = 120
const EASE_OUT_EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)'
/** Peek photo box: 4:5, the ID-photo shape, 4.5x the 80px tile; the photo is fitted inside it. */
const PEEK_MAX = { width: 360, height: 450 }
/** The peek lifts this far out past the tile's top-start corner. */
const PEEK_LIFT = 12
const VIEWPORT_MARGIN = 12

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
  const width = Math.min(max.width, max.height * ratio)
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
 * Where the peek frame sits: lifted past the tile's inline-start top corner
 * (left in LTR, right in RTL), kept inside the viewport. Derived on every
 * render, so the frame stays anchored when the photo's aspect arrives late.
 */
function placePeek(tile: DOMRect, rtl: boolean, photo: Size): { left: number; top: number } {
  // Frame = photo + p-1.5 + 1px border on each side, plus a caption of up to
  // two name lines and the ID below it.
  const frameWidth = photo.width + 14
  const frameHeight = photo.height + 14 + 72
  const left = rtl ? tile.right + PEEK_LIFT - frameWidth : tile.left - PEEK_LIFT
  const clamp = (value: number, room: number): number =>
    Math.max(VIEWPORT_MARGIN, Math.min(value, room - VIEWPORT_MARGIN))
  return {
    left: clamp(left, window.innerWidth - frameWidth),
    top: clamp(tile.top - PEEK_LIFT, window.innerHeight - frameHeight),
  }
}

export function EmployeePhotoPreview({ src, name, altName, employeeId }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const tileRef = useRef<HTMLButtonElement>(null)
  const peekRef = useRef<HTMLDivElement>(null)
  const intentTimer = useRef<number | undefined>(undefined)
  /** Focus that a pointer press or the dialog's focus return caused shows no peek. */
  const skipFocusPeek = useRef(false)
  const [natural, setNatural] = useState<Size | null>(null)
  /** `closing` keeps the peek mounted while it shrinks back into the tile. */
  const [peek, setPeek] = useState<'closed' | 'open' | 'closing'>('closed')
  /** The tile's box and direction when the peek opened; placement derives from it. */
  const [peekAnchor, setPeekAnchor] = useState<{ tile: DOMRect; rtl: boolean } | null>(null)
  const [fullFrom, setFullFrom] = useState<DOMRect | null>(null)

  const peekBox = fitPhoto(natural, PEEK_MAX)
  const peekPlace = peekAnchor && placePeek(peekAnchor.tile, peekAnchor.rtl, peekBox)

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
    const next = canAnimate(reducedMotion) ? 'closing' : 'closed'
    setPeek((state) => (state === 'open' ? next : state))
  }, [reducedMotion])

  // Grow the peek out of the tile on open; shrink it back on close.
  useLayoutEffect(() => {
    const frame = peekRef.current
    const tile = tileRef.current
    if (peek === 'closed' || !frame || !tile || !canAnimate(reducedMotion)) return
    const animation = growFrom(frame, tile.getBoundingClientRect(), {
      duration: peek === 'open' ? 220 : 150,
      reverse: peek === 'closing',
    })
    if (peek === 'closing') animation.onfinish = () => setPeek('closed')
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

  useEffect(() => () => window.clearTimeout(intentTimer.current), [])

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
          window.clearTimeout(intentTimer.current)
          intentTimer.current = window.setTimeout(openPeek, HOVER_INTENT_MS)
        }}
        onPointerLeave={closePeek}
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
            className="pointer-events-none fixed z-50 rounded-2xl border border-hairline bg-surface p-1.5 shadow-xl"
            style={{ left: peekPlace.left, top: peekPlace.top }}
          >
            <img
              src={src}
              alt=""
              width={peekBox.width}
              height={peekBox.height}
              className="block rounded-[12px] object-cover"
              style={{ width: peekBox.width, height: peekBox.height }}
            />
            <div className="px-1.5 pb-1 pt-2 text-start" style={{ width: peekBox.width }}>
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
