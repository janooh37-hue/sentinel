import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { cn } from '@/lib/utils'

// Re-export the Radix primitives as proper React components so the
// react-refresh ESLint rule (which forbids non-component named exports
// from component files) keeps quiet. The wrappers add no logic beyond
// passing props straight through.

export function TooltipProvider(
  props: React.ComponentProps<typeof TooltipPrimitive.Provider>,
): React.JSX.Element {
  return <TooltipPrimitive.Provider {...props} />
}

export function Tooltip(
  props: React.ComponentProps<typeof TooltipPrimitive.Root>,
): React.JSX.Element {
  return <TooltipPrimitive.Root {...props} />
}

export function TooltipTrigger(
  props: React.ComponentProps<typeof TooltipPrimitive.Trigger>,
): React.JSX.Element {
  return <TooltipPrimitive.Trigger {...props} />
}

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      'z-50 overflow-hidden rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground shadow-sm',
      // Fast, subtle enter (~120ms): fade + slight zoom + a small slide from
      // the resolved side, origin-aware. Exit is quieter — fade only, faster —
      // so it stays subtler than the enter (fixes the prior backwards
      // asymmetry where only the exit animated). Reduced-motion guarded.
      'origin-[var(--radix-tooltip-content-transform-origin)]',
      'data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-[state=delayed-open]:duration-[120ms]',
      'data-[state=delayed-open]:data-[side=top]:slide-in-from-bottom-1 data-[state=delayed-open]:data-[side=bottom]:slide-in-from-top-1',
      'data-[state=delayed-open]:data-[side=left]:slide-in-from-right-1 data-[state=delayed-open]:data-[side=right]:slide-in-from-left-1',
      'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100',
      'motion-reduce:animate-none',
      className,
    )}
    {...props}
  />
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName
