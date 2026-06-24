/**
 * Dialog — a general modal built on @radix-ui/react-dialog (same dep as Sheet /
 * AlertDialog). For non-confirmation modals that own their own body chrome
 * (e.g. the Ledger rules editor). Portals to body, so it escapes any
 * overflow/transform ancestor (see the floating-ui-portal-pattern memo).
 *
 * API mirrors shadcn/ui Dialog:
 *   <Dialog open onOpenChange>
 *     <DialogContent>
 *       <DialogHeader><DialogTitle/><DialogDescription/></DialogHeader>
 *       …body…
 *     </DialogContent>
 *   </Dialog>
 */

import * as Dialog from '@radix-ui/react-dialog'
import * as React from 'react'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

export function DialogRoot(
  props: React.ComponentPropsWithoutRef<typeof Dialog.Root>,
): React.JSX.Element {
  return <Dialog.Root {...props} />
}

export function DialogTrigger(
  props: React.ComponentPropsWithoutRef<typeof Dialog.Trigger>,
): React.JSX.Element {
  return <Dialog.Trigger {...props} />
}

export function DialogClose(
  props: React.ComponentPropsWithoutRef<typeof Dialog.Close>,
): React.JSX.Element {
  return <Dialog.Close {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Dialog.Overlay>): React.JSX.Element {
  return (
    <Dialog.Overlay
      className={cn(
        'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150',
        'motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  )
}

export function DialogContent({
  className,
  children,
  /** Hide the built-in top-end close button (the modal supplies its own). */
  hideClose = false,
  ...props
}: React.ComponentPropsWithoutRef<typeof Dialog.Content> & {
  hideClose?: boolean
}): React.JSX.Element {
  return (
    <Dialog.Portal>
      <DialogOverlay />
      <Dialog.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-3.5rem)] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col',
          'overflow-hidden rounded-2xl border border-hairline bg-surface shadow-xl',
          'focus-visible:outline-none',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-200',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-150',
          'motion-reduce:animate-none',
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <Dialog.Close
            className="absolute end-3.5 top-3.5 rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden />
          </Dialog.Close>
        )}
      </Dialog.Content>
    </Dialog.Portal>
  )
}

export function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn('flex flex-none flex-col gap-1 border-b border-border px-4 py-3.5 text-start', className)}
      {...props}
    />
  )
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Dialog.Title>): React.JSX.Element {
  return (
    <Dialog.Title
      className={cn('text-sm font-bold text-foreground', className)}
      {...props}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Dialog.Description>): React.JSX.Element {
  return (
    <Dialog.Description
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}
