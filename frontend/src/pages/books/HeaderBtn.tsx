import { Loader2 } from 'lucide-react'
import { forwardRef, useId } from 'react'

import { Hint } from '@/components/ui/hint'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/lib/useIsMobile'

export type BtnTone = 'plain' | 'amber' | 'red' | 'green-solid' | 'navy-solid'
// `Omit<..., 'onClick'>` + the narrower `onClick?: () => void` below: Radix's
// `asChild` clone (DropdownMenu trigger) injects its own aria-haspopup /
// aria-expanded / data-state / onPointerDown etc. onto this element, which
// `{...rest}` must type-check and forward for the trigger to be keyboard- and
// screen-reader-operable.
export const HeaderBtn = forwardRef<
  HTMLButtonElement,
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
    icon: React.ReactNode
    label: string
    tone?: BtnTone
    onClick?: () => void
    disabled?: boolean
    testId?: string
    ariaPressed?: boolean
    iconOnly?: boolean
    grow?: boolean
    /** Shown in the tooltip and exposed via `aria-keyshortcuts`. */
    shortcut?: string
    /** Why the action is unavailable. Sets `aria-disabled` (the button stays
     *  focusable, click is a no-op); the reason shows as a tooltip on desktop
     *  and as a visible helper line on touch. */
    reason?: string
    /** Spinner + `aria-busy`; the label swaps to `pendingLabel`. Click is a no-op. */
    pending?: boolean
    pendingLabel?: string
  }
>(function HeaderBtn(
  {
    icon,
    label,
    tone = 'plain',
    onClick,
    disabled,
    testId,
    ariaPressed,
    iconOnly = false,
    grow = false,
    shortcut,
    reason,
    pending = false,
    pendingLabel,
    className,
    ...rest
  },
  ref,
): React.JSX.Element {
  const styles: Record<BtnTone, string> = {
    plain: 'border-hairline bg-surface text-primary hover:bg-surface-tinted',
    amber: 'border-warning/40 bg-surface text-warning hover:bg-warning/10',
    red: 'border-accent/40 bg-surface text-accent hover:bg-accent/10',
    'green-solid': 'border-transparent bg-success text-white hover:bg-success/90',
    'navy-solid': 'border-transparent bg-primary text-primary-foreground hover:bg-primary-hover',
  }
  const isMobile = useIsMobile()
  const reasonId = useId()
  const blocked = Boolean(reason) || pending
  const shownLabel = pending && pendingLabel ? pendingLabel : label
  const touchReason = Boolean(reason) && isMobile
  // Desktop reason wins (the shortcut does not apply while blocked); otherwise
  // a shortcut gets a label + key tooltip. Touch shows the reason inline.
  const hintLabel = reason ? (isMobile ? undefined : reason) : shortcut ? shownLabel : undefined
  const hinted = Boolean(hintLabel)
  const button = (
    <button
      ref={ref}
      type="button"
      data-testid={testId}
      onClick={blocked ? undefined : onClick}
      disabled={disabled}
      aria-pressed={ariaPressed}
      aria-label={iconOnly ? shownLabel : undefined}
      title={iconOnly && !hinted ? shownLabel : undefined}
      aria-disabled={blocked ? true : undefined}
      aria-busy={pending ? true : undefined}
      aria-keyshortcuts={shortcut}
      aria-describedby={touchReason ? reasonId : undefined}
      {...rest}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[0.78em] font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        blocked && 'opacity-60',
        styles[tone],
        iconOnly && 'w-9 shrink-0 justify-center px-0',
        grow && 'max-lg:flex-1 max-lg:justify-center',
        className,
      )}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        icon
      )}
      {iconOnly ? null : shownLabel}
    </button>
  )
  const withHint =
    hintLabel ? (
      <Hint label={hintLabel} shortcut={reason ? undefined : shortcut} side="bottom">
        {button}
      </Hint>
    ) : (
      button
    )
  if (!touchReason) return withHint
  return (
    <span className={cn('inline-flex flex-col items-start gap-0.5', grow && 'max-lg:flex-1')}>
      {withHint}
      <span id={reasonId} className="max-w-[16rem] text-[0.7em] leading-tight text-muted-foreground">
        {reason}
      </span>
    </span>
  )
})
