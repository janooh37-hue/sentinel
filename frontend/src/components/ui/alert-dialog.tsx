/**
 * AlertDialog — a blocking confirmation dialog built on @radix-ui/react-dialog.
 *
 * API mirrors shadcn/ui AlertDialog so it can be swapped in the future:
 *   AlertDialog, AlertDialogTrigger, AlertDialogContent,
 *   AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
 *   AlertDialogFooter, AlertDialogAction, AlertDialogCancel
 */

import * as Dialog from '@radix-ui/react-dialog'
import * as React from 'react'

import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button-variants'

export function AlertDialog(
  props: React.ComponentPropsWithoutRef<typeof Dialog.Root>,
): React.JSX.Element {
  return <Dialog.Root {...props} />
}

export function AlertDialogTrigger(
  props: React.ComponentPropsWithoutRef<typeof Dialog.Trigger>,
): React.JSX.Element {
  return <Dialog.Trigger {...props} />
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Dialog.Overlay>): React.JSX.Element {
  return (
    <Dialog.Overlay
      className={cn(
        'fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]',
        className,
      )}
      {...props}
    />
  )
}

export function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof Dialog.Content>): React.JSX.Element {
  return (
    <Dialog.Portal>
      <AlertDialogOverlay />
      <Dialog.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2',
          'rounded-2xl border border-hairline bg-surface p-6 shadow-xl',
          'focus-visible:outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  )
}

export function AlertDialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn('flex flex-col gap-1.5 text-start', className)}
      {...props}
    />
  )
}

export function AlertDialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Dialog.Title>): React.JSX.Element {
  return (
    <Dialog.Title
      className={cn('text-base font-semibold text-foreground', className)}
      {...props}
    />
  )
}

export function AlertDialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Dialog.Description>): React.JSX.Element {
  return (
    <Dialog.Description
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export function AlertDialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn('mt-5 flex flex-row-reverse gap-2', className)}
      {...props}
    />
  )
}

export function AlertDialogAction({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(buttonVariants({ variant: 'default' }), className)}
      {...props}
    />
  )
}

export function AlertDialogCancel({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(buttonVariants({ variant: 'secondary' }), className)}
      {...props}
    />
  )
}
