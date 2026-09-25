import { forwardRef } from 'react'

import { cn } from '@/lib/utils'

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
  return (
    <button
      ref={ref}
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={ariaPressed}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      {...rest}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[0.78em] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        styles[tone],
        iconOnly && 'w-9 shrink-0 justify-center px-0',
        grow && 'max-lg:flex-1 max-lg:justify-center',
        className,
      )}
    >
      {icon}
      {iconOnly ? null : label}
    </button>
  )
})
