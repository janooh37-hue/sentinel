/**
 * DropdownMenu — popover menu built on @radix-ui/react-dropdown-menu.
 *
 * Why this exists: hand-rolled `position:absolute` row menus get clipped by any
 * ancestor that scrolls (`overflow:auto`) or establishes a stacking context
 * (a transformed parent, e.g. the route-transition wrapper). Radix portals the
 * content to the document body and positions it with Popper (flip + clamp to
 * the viewport), so the menu always escapes the table/scroll container and
 * paints above the page. It also brings focus management, arrow-key nav,
 * type-ahead, Escape + outside-click, and RTL (Radix reads document `dir`).
 *
 * Chrome matches the app's other popovers (Select / NavBell): themed surface,
 * hairline border, soft shadow, origin-aware reveal, reduced-motion guarded.
 *
 * API mirrors shadcn/ui:
 *   <DropdownMenu>
 *     <DropdownMenuTrigger asChild><button…/></DropdownMenuTrigger>
 *     <DropdownMenuContent>
 *       <DropdownMenuItem onSelect={…}>…</DropdownMenuItem>
 *       <DropdownMenuSeparator />
 *       <DropdownMenuItem variant="danger" disabled>…</DropdownMenuItem>
 *     </DropdownMenuContent>
 *   </DropdownMenu>
 */

import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'

import { cn } from '@/lib/utils'

/** Root + sub-parts wrapped (not re-exported) so this file only exports
 *  component declarations — keeps react-refresh happy. */
export function DropdownMenu(
  props: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>,
): React.JSX.Element {
  return <DropdownMenuPrimitive.Root {...props} />
}

export const DropdownMenuTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>((props, ref) => <DropdownMenuPrimitive.Trigger ref={ref} {...props} />)
DropdownMenuTrigger.displayName = DropdownMenuPrimitive.Trigger.displayName

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, align = 'end', ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 min-w-[12rem] overflow-hidden rounded-xl border border-border bg-surface p-1 text-foreground shadow-xl',
        'origin-[var(--radix-dropdown-menu-content-transform-origin)]',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-150',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-100',
        'motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    variant?: 'default' | 'danger'
  }
>(({ className, variant = 'default', ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.84em] outline-none transition-colors',
      'focus:bg-surface-tinted data-[highlighted]:bg-surface-tinted',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
      variant === 'danger' ? 'text-accent' : 'text-foreground',
      className,
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('my-1 h-px bg-hairline', className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName
