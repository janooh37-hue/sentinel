import { cva } from 'class-variance-authority'

export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium uppercase tracking-[0.06em] whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-muted-foreground',
        active: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-destructive/10 text-destructive',
        info: 'bg-info-soft text-info',
        outline: 'border border-border text-muted-foreground',
      },
      shape: {
        pill: 'rounded-full',
        square: 'rounded-md',
        dotled: 'rounded-full border border-dashed',
      },
    },
    defaultVariants: { tone: 'neutral', shape: 'pill' },
  },
)
