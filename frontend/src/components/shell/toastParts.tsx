/**
 * The pieces lib/toast.ts puts inside a Sileo toast: the badge glyphs, the Undo
 * countdown, a record reference chip, and server text shown in its own language.
 * Styled in AppToaster.css.
 */
import { ArrowRight, Check, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { useSyncExternalStore, type ReactNode } from 'react'
import type { SileoState } from 'sileo'

import { getToastHold, subscribeToastHold } from '@/lib/toastHold'

/** The app's lucide set at the badge's size; the action arrow mirrors in Arabic. */
export function ToastStateIcon({ state, size = 15 }: { state: SileoState; size?: number }): React.JSX.Element {
  const props = { size, strokeWidth: 2, 'aria-hidden': true } as const
  switch (state) {
    case 'success':
      return <Check {...props} />
    case 'error':
      return <X {...props} />
    case 'warning':
      return <TriangleAlert {...props} />
    case 'info':
      return <Info {...props} />
    case 'action':
      return <ArrowRight {...props} className="rtl:-scale-x-100" />
    case 'loading':
      // Sileo's spin animation (and the reduced-motion exemption) key on this.
      return <LoaderCircle {...props} data-sileo-icon="spin" />
  }
}

/**
 * A ring around the badge glyph that drains over the toast's close window, so
 * an Undo shows how long it is still on offer. It pauses while the stack is
 * held and restarts with Sileo's timers when it is released.
 */
export function ToastCountdown({ durationMs, children }: { durationMs: number; children: ReactNode }): React.JSX.Element {
  const { held, epoch } = useSyncExternalStore(subscribeToastHold, getToastHold, getToastHold)
  return (
    <span className="toast-countdown">
      <svg className="toast-countdown-ring rtl:-scale-x-100" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="toast-countdown-track" cx="12" cy="12" r="11" />
        <circle
          key={epoch}
          className="toast-countdown-fill"
          cx="12"
          cy="12"
          r="11"
          pathLength={100}
          style={{ animationDuration: `${durationMs}ms`, animationPlayState: held ? 'paused' : 'running' }}
        />
      </svg>
      {children}
    </span>
  )
}

/** A record number or code, set in the app's mono face and kept left-to-right. */
export function ToastReference({ value }: { value: string }): React.JSX.Element {
  return (
    <span className="toast-ref" dir="ltr">
      {value}
    </span>
  )
}

/** Server text in the other language, isolated in its own direction. */
export function ToastForeignText({ text }: { text: string }): React.JSX.Element {
  return (
    <span className="toast-foreign" lang="en" dir="ltr">
      {text}
    </span>
  )
}
