import { cn } from '@/lib/utils'

export type BtnTone = 'plain' | 'amber' | 'red' | 'green-solid' | 'navy-solid'
export function HeaderBtn({
  icon,
  label,
  tone = 'plain',
  onClick,
  disabled,
  testId,
  ariaPressed,
}: {
  icon: React.ReactNode
  label: string
  tone?: BtnTone
  onClick?: () => void
  disabled?: boolean
  testId?: string
  ariaPressed?: boolean
}): React.JSX.Element {
  const styles: Record<BtnTone, string> = {
    plain: 'border-hairline bg-surface text-primary hover:bg-surface-tinted',
    amber: 'border-warning/40 bg-surface text-warning hover:bg-warning/10',
    red: 'border-accent/40 bg-surface text-accent hover:bg-accent/10',
    'green-solid': 'border-transparent bg-success text-white hover:bg-success/90',
    'navy-solid': 'border-transparent bg-primary text-primary-foreground hover:bg-primary-hover',
  }
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={ariaPressed}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[0.78em] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        styles[tone],
      )}
    >
      {icon}
      {label}
    </button>
  )
}
