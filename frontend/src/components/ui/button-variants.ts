import { cva } from 'class-variance-authority'

export const buttonVariants = cva(
  // Base. `active:scale-[0.98]` gives an immediate tactile press confirmation
  // on every button (Emil: scale your buttons); `transition-transform` keeps
  // the release smooth, and motion-reduce neutralizes it. The `commit` variant
  // overrides transform on active with its own press treatment.
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium leading-none transition-[color,background-color,border-color,transform] active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/95',
        secondary:
          'border border-border bg-surface text-foreground hover:bg-accent',
        outline:
          'border border-border bg-transparent text-foreground hover:bg-accent',
        ghost:
          'text-muted-foreground hover:bg-accent hover:text-foreground',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        link:
          'text-primary underline-offset-4 hover:underline',
        // Commit — final actions that mint a ref number (Generate document,
        // Issue clearance). Quietly heavier than primary: a faint inset top
        // highlight reads slightly raised, a tight drop shadow, and on hover
        // it lifts 1px and gains a soft primary halo so the operator feels
        // the click is about to land. Pair with `size="commit"`.
        commit:
          'bg-primary text-primary-foreground rounded-[13px] font-semibold ' +
          'shadow-[inset_0_1px_0_rgb(255_255_255_/_0.10),0_2px_4px_-1px_rgb(0_0_0_/_0.10)] ' +
          'transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ' +
          'hover:bg-primary-hover hover:-translate-y-px ' +
          'hover:shadow-[inset_0_1px_0_rgb(255_255_255_/_0.14),0_4px_8px_-2px_rgb(0_0_0_/_0.12),0_0_0_3px_color-mix(in_oklab,var(--primary)_10%,transparent)] ' +
          'active:translate-y-0 active:scale-100 active:shadow-[inset_0_2px_4px_rgb(0_0_0_/_0.14),0_1px_2px_0_rgb(0_0_0_/_0.06)] ' +
          'motion-reduce:!transform-none motion-reduce:!transition-none',
      },
      size: {
        default: 'h-9 px-3.5',
        sm: 'h-8 px-3 text-xs',
        xs: 'h-7 px-2.5 text-xs',
        lg: 'h-10 px-5',
        commit: 'h-[42px] px-[18px]',
        icon: 'h-9 w-9 p-0',
        'icon-sm': 'h-8 w-8 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)
