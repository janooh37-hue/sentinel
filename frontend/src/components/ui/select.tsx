/**
 * Select — popover-based dropdown built on @radix-ui/react-select.
 *
 * Replaces the previous styled-native `<select>`. Matches the design-system
 * `.trigger` chrome (components-form-input.html): 38px height, 12px radius,
 * 1px border → border-strong on hover → primary + 3px ring on focus/open, a
 * chevron that rotates 180° when open. The option list is a themed popover
 * (same surface / hairline / shadow as the app's other popovers), so it works
 * in dark mode and RTL (Radix reads document `dir`).
 *
 * API mirrors shadcn/ui Select:
 *   <Select value onValueChange>
 *     <SelectTrigger><SelectValue placeholder=… /></SelectTrigger>
 *     <SelectContent>
 *       <SelectItem value=…>…</SelectItem>
 *     </SelectContent>
 *   </Select>
 */

import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

/** Root provider. Wrapped (rather than re-exported) so the file only exports
 *  component declarations — keeps react-refresh / fast-refresh happy. */
export function Select(
  props: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Root>,
): React.JSX.Element {
  return <SelectPrimitive.Root {...props} />
}

export const SelectGroup = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Group>
>((props, ref) => <SelectPrimitive.Group ref={ref} {...props} />)
SelectGroup.displayName = SelectPrimitive.Group.displayName

export const SelectValue = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Value>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Value>
>((props, ref) => <SelectPrimitive.Value ref={ref} {...props} />)
SelectValue.displayName = SelectPrimitive.Value.displayName

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'group flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none transition-[border,box-shadow] duration-150',
      'hover:border-border-strong',
      'focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20',
      'data-[state=open]:border-primary data-[state=open]:ring-[3px] data-[state=open]:ring-primary/20',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[placeholder]:text-faint',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown
        className="h-4 w-4 shrink-0 text-faint transition-transform duration-150 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
        strokeWidth={1.8}
        aria-hidden
      />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        'relative z-50 max-h-[var(--radix-select-content-available-height)] min-w-[8rem] overflow-hidden rounded-md border border-hairline bg-surface text-foreground shadow-lg',
        // Origin-aware reveal: the list grows from the trigger edge (Radix
        // sets the transform-origin per resolved side). Fast (~150ms) since
        // the trigger already animates on open; reduced-motion guarded.
        'origin-[var(--radix-select-content-transform-origin)]',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-150',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-100',
        'motion-reduce:animate-none',
        position === 'popper' &&
          'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport
        className={cn(
          'p-1',
          position === 'popper' &&
            'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]',
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

export const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pe-2 ps-8 text-sm text-foreground outline-none',
      'focus:bg-surface-tinted focus:text-foreground',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute inset-y-0 start-2 flex items-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4 text-primary" strokeWidth={2} aria-hidden />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

export const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-hairline', className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName
