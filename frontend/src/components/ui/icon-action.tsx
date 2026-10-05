import * as React from 'react'

import { cn } from '@/lib/utils'

import { Hint, type HintSide } from './hint'

type IconActionProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title'> & {
  /** Required: icon-only controls have no other accessible name. */
  'aria-label': string
  pressed?: boolean
  tone?: 'default' | 'danger'
  /** Tooltip text. Defaults to the aria-label when `shortcut` is given. */
  hint?: string
  shortcut?: string
  hintSide?: HintSide
}

export const IconAction = React.forwardRef<HTMLButtonElement, IconActionProps>(
  function IconAction(
    { pressed, tone = 'default', hint, shortcut, hintSide, className, children, ...rest },
    ref,
  ): React.JSX.Element {
    const button = (
      <button
        ref={ref}
        type="button"
        aria-pressed={pressed}
        {...rest}
        className={cn(
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface transition-colors motion-reduce:transition-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
          tone === 'danger'
            ? 'text-accent hover:bg-accent/10'
            : 'text-primary hover:bg-surface-tinted',
          pressed && 'bg-surface-tinted',
          className,
        )}
      >
        {children}
      </button>
    )
    const label = hint ?? (shortcut ? rest['aria-label'] : undefined)
    if (!label) return button
    return (
      <Hint label={label} shortcut={shortcut} side={hintSide}>
        {button}
      </Hint>
    )
  },
)
