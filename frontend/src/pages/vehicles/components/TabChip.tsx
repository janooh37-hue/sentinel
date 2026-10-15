import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { formatNumber } from '../vehicleUtils'

export function TabChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count?: number
  onClick: () => void
}): React.JSX.Element {
  const { i18n } = useTranslation()
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[0.78rem] font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'motion-reduce:transition-none',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground',
      )}
    >
      {label}
      {count != null && <span
        className={cn(
          'font-mono text-[0.7rem] tabular-nums',
          active ? 'opacity-75' : 'text-faint',
        )}
      >
        {formatNumber(count, i18n.language)}
      </span>}
    </button>
  )
}
