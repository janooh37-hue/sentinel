import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'

import { cn } from '@/lib/utils'

/**
 * Progress — shadcn-style determinate bar over Radix Progress.
 *
 * The indicator is absolutely positioned and pinned to the track's
 * inline-start edge (`start-0`), then sized by width. Logical inset + width
 * means it fills left→right in LTR and right→left in RTL with no directional
 * special-casing.
 *
 * No CSS width transition: the smooth motion is produced by the caller feeding
 * a per-frame value (see useFakeProgress). A CSS transition on top of that
 * would double-animate and lag the rendered fill behind the real value.
 */
export const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => {
  const clamped = Math.max(0, Math.min(100, value ?? 0))
  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={clamped}
      className={cn(
        'relative h-1.5 w-full overflow-hidden rounded-full bg-surface-tinted',
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="absolute inset-y-0 start-0 rounded-full bg-primary"
        style={{ width: `${clamped}%` }}
      />
    </ProgressPrimitive.Root>
  )
})
Progress.displayName = ProgressPrimitive.Root.displayName
