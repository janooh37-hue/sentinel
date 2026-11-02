/**
 * Sheet — a Radix Dialog styled as a slide-in panel from the inline-start
 * edge. Respects RTL. Used by NavDrawer on mobile.
 *
 * API is a subset of shadcn/ui Sheet: Sheet, SheetTrigger, SheetClose,
 * SheetContent. No external overlay; it's built into SheetContent.
 */

import * as Dialog from '@radix-ui/react-dialog'
import * as React from 'react'

import { cn } from '@/lib/utils'

export function Sheet(props: React.ComponentPropsWithoutRef<typeof Dialog.Root>): React.JSX.Element {
  return <Dialog.Root {...props} />
}

export function SheetTrigger(
  props: React.ComponentPropsWithoutRef<typeof Dialog.Trigger>,
): React.JSX.Element {
  return <Dialog.Trigger {...props} />
}

export function SheetClose(
  props: React.ComponentPropsWithoutRef<typeof Dialog.Close>,
): React.JSX.Element {
  return <Dialog.Close {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Dialog.Overlay>): React.JSX.Element {
  return (
    <Dialog.Overlay
      className={cn(
        'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]',
        // Scrim fades in with the panel, out a touch faster (subtler exit).
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-300',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200',
        'motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  )
}

export function SheetTitle(
  props: React.ComponentPropsWithoutRef<typeof Dialog.Title>,
): React.JSX.Element {
  return <Dialog.Title {...props} />
}

export function SheetContent({
  className,
  children,
  returnFocusRef,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentPropsWithoutRef<typeof Dialog.Content> & {
  /** Stable return target when a tap does not focus the opener or it is replaced. */
  returnFocusRef?: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const openerRef = React.useRef<HTMLElement | null>(null)
  return (
    <Dialog.Portal>
      <SheetOverlay />
      <Dialog.Content
        className={cn(
          // Slide in from the inline-start edge (left in LTR, right in RTL).
          // `.sheet-panel` carries the direction-aware slide keyframes + iOS
          // curve (see index.css); reduced-motion is guarded there.
          'sheet-panel fixed inset-y-0 start-0 z-50 flex h-full w-72 flex-col bg-surface shadow-2xl',
          'focus-visible:outline-none',
          className,
        )}
        {...props}
        onOpenAutoFocus={(event) => {
          openerRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
          onOpenAutoFocus?.(event)
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          if (event.defaultPrevented) return
          const target = returnFocusRef?.current ?? openerRef.current
          if (target?.isConnected && target !== document.body) {
            event.preventDefault()
            target.focus()
          }
        }}
      >
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  )
}
