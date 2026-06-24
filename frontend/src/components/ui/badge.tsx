import * as React from 'react'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

import { badgeVariants } from './badge-variants'

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants> & { withDot?: boolean }

export function Badge({ className, tone, shape, withDot, children, ...props }: BadgeProps): React.JSX.Element {
  return (
    <span className={cn(badgeVariants({ tone, shape }), className)} {...props}>
      {withDot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}
