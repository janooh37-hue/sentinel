import * as React from 'react'

import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        // Desktop Chromium gives date/time inputs a separate Tab stop on the picker icon, whose UA focus ring is
        // near-black and vanishes on dark surfaces. Chromium matches no pseudo-class on
        // ::-webkit-calendar-picker-indicator; while the icon is focused the input matches :focus-within but not
        // :focus, so key the ring off that. Outlines are clipped there and var-composed ring utilities don't
        // apply, so set the ring token's colour as a literal inset box-shadow.
        '[&:focus-within:not(:focus)::-webkit-calendar-picker-indicator]:rounded-sm [&:focus-within:not(:focus)::-webkit-calendar-picker-indicator]:outline-none [&:focus-within:not(:focus)::-webkit-calendar-picker-indicator]:[box-shadow:inset_0_0_0_2px_var(--color-ring)]',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
