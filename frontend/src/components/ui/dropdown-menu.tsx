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

import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'

import { Kbd } from './kbd'

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
    /** Why the item is unavailable. Sets `aria-disabled` (the item stays
     *  focusable and its reason is read) and shows the reason on a second
     *  line; selecting it is a no-op. Works on touch, unlike a tooltip. */
    reason?: string
    /** Key hint shown at the item's end + `aria-keyshortcuts`. */
    shortcut?: string
    /** Spinner + `aria-busy`; selecting is a no-op. */
    pending?: boolean
  }
>(
  (
    { className, variant = 'default', reason, shortcut, pending = false, onSelect, children, ...props },
    ref,
  ) => {
    const reasonId = React.useId()
    const blocked = Boolean(reason) || pending
    return (
      <DropdownMenuPrimitive.Item
        ref={ref}
        {...(blocked ? { 'aria-disabled': true } : null)}
        {...(pending ? { 'aria-busy': true } : null)}
        {...(shortcut && !reason ? { 'aria-keyshortcuts': shortcut } : null)}
        {...(reason ? { 'aria-describedby': reasonId } : null)}
        {...(blocked || onSelect
          ? {
              onSelect: blocked
                ? (event: Event) => {
                    event.preventDefault()
                  }
                : onSelect,
            }
          : null)}
        className={cn(
          'flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.84em] outline-none transition-colors motion-reduce:transition-none',
          'focus:bg-surface-tinted data-[highlighted]:bg-surface-tinted',
          'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
          blocked && 'cursor-not-allowed opacity-60',
          variant === 'danger' ? 'text-accent' : 'text-foreground',
          className,
        )}
        {...props}
      >
        {props.asChild ? (
          children
        ) : reason ? (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2.5">{children}</span>
            <span id={reasonId} className="text-[0.85em] leading-snug text-muted-foreground">
              {reason}
            </span>
          </span>
        ) : (
          children
        )}
        {pending && !props.asChild ? (
          <Loader2
            className="ms-auto h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : null}
        {shortcut && !reason && !pending && !props.asChild ? (
          <span className="ms-auto ps-4">
            <Kbd>{shortcut}</Kbd>
          </span>
        ) : null}
      </DropdownMenuPrimitive.Item>
    )
  },
)
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
