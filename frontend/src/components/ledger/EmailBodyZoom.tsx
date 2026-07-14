/**
 * EmailBodyZoom — the MOBILE reading surface for an email body.
 *
 * On a phone, wide email content (multi-column / fixed-width tables, fixed-layout
 * shells) exceeds the viewport and was previously clipped with no scroll. This
 * wraps the rendered body in a fit-to-width pan/zoom surface: it opens zoomed out
 * (whole email visible), then accepts drag-to-pan (all directions), two-finger
 * pinch, and wheel-zoom (desktop testing), with a − / Fit / + control.
 *
 * Pan/zoom math + gestures live in `lib/usePanZoom` (mirrors RecordPaperViewer's
 * grab-to-pan pattern but transforms the whole body, since live HTML can't be
 * reflowed). The body itself is rendered by the shared `BodyContent` from
 * EmailBody so smartlinks, cid rewriting and per-body `dir` behave identically.
 */

import { useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { usePanZoom } from '@/lib/usePanZoom'
import { cn } from '@/lib/utils'

import { BodyContent, type EmailBodyProps } from './EmailBody'

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function EmailBodyZoom(props: EmailBodyProps): React.JSX.Element {
  const { t } = useTranslation()
  const { viewportRef, contentRef, grabbing, transform, reset, zoomBy, handlers } = usePanZoom()

  // Re-fit once the body HTML has been written by BodyContent (next frame, so
  // the content's intrinsic width is measurable). reset() also runs on resize.
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => reset())
    return () => cancelAnimationFrame(id)
  }, [props.html, reset])

  return (
    <div className="relative overflow-hidden rounded-2xl border border-hairline bg-surface">
      {/* − / Fit / + control — chrome, stays LTR; logical end inset for RTL. */}
      <div className="absolute end-2 top-2 z-10 flex items-center gap-1 rounded-[--radius-sm] border border-border-strong bg-surface-raised/95 px-1 py-0.5 shadow-sm backdrop-blur">
        <CtrlBtn label={t('ledger.body.zoomOut', { defaultValue: 'Zoom out' })} onClick={() => zoomBy(-1)}>
          −
        </CtrlBtn>
        <button
          type="button"
          onClick={reset}
          className="rounded-sm px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('ledger.body.fit', { defaultValue: 'Fit' })}
        </button>
        <CtrlBtn label={t('ledger.body.zoomIn', { defaultValue: 'Zoom in' })} onClick={() => zoomBy(1)}>
          ＋
        </CtrlBtn>
      </div>

      {/* viewport — touch-action:none so the browser doesn't steal the gesture */}
      <div
        ref={viewportRef}
        {...handlers}
        className={cn(
          'relative h-[60vh] w-full touch-none select-none overflow-hidden',
          grabbing ? 'cursor-grabbing' : 'cursor-grab',
        )}
        role="group"
        aria-label={t('ledger.body.zoomHint', { defaultValue: 'Drag to pan · pinch to zoom' })}
      >
        {/* transform layer — origin top-left, no animated transition (reduced-motion safe) */}
        <div
          ref={contentRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transformOrigin: '0 0',
            transform: transform,
            transition: REDUCED_MOTION ? undefined : 'transform 60ms linear',
            willChange: 'transform',
          }}
        >
          {/* Inline-width body so the content has a measurable intrinsic width. */}
          <div className="w-[640px] max-w-[640px]">
            <BodyContent {...props} variant="zoom" />
          </div>
        </div>
      </div>
    </div>
  )
}

function CtrlBtn({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-sm text-base font-semibold text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  )
}
