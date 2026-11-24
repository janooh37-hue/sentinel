interface SegmentedFilterProps<T extends string> {
  label: string
  choices: readonly T[]
  value: T
  onChange(value: T): void
  optionLabel(value: T): string
  className?: string
  compact?: boolean
}

const BUTTON = 'min-h-[44px] min-w-[44px] rounded-sm border border-transparent! text-xs text-muted-foreground focus-visible:outline-none! focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-surface aria-pressed:text-primary-text [[data-theme=dark]_&]:aria-pressed:border-border-strong! [[data-theme=dark]_&]:aria-pressed:bg-primary-soft [[data-theme=dark]_&]:aria-pressed:text-foreground'
const COMPACT_BUTTON = 'cursor-pointer px-2 hover:bg-surface-raised aria-pressed:font-semibold md:min-h-8'
const FILTER_BUTTON = 'flex-auto whitespace-nowrap px-1 font-semibold transition-colors hover:text-foreground motion-reduce:transition-none lg:min-h-8 lg:flex-none lg:px-2.5'

export function SegmentedFilter<T extends string>({
  label, choices, value, onChange, optionLabel, className = '', compact = false,
}: SegmentedFilterProps<T>) {
  const group = (
    <div role="group" aria-label={label} className={`max-w-full flex-wrap items-stretch gap-0.5 rounded-md bg-surface-tinted p-0.5 ${compact ? `inline-flex border ${className}` : 'flex'}`}>
      {choices.map((choice) => (
        <button
          key={choice}
          type="button"
          aria-pressed={choice === value}
          onClick={() => onChange(choice)}
          className={`${BUTTON} ${compact ? COMPACT_BUTTON : FILTER_BUTTON}`}
        >
          {optionLabel(choice)}
        </button>
      ))}
    </div>
  )
  return compact ? group : (
    <div className={`grid min-w-0 gap-1 lg:flex lg:items-center lg:gap-2 ${className}`}>
      <span aria-hidden="true" className="whitespace-nowrap text-xs font-bold">{label}</span>
      {group}
    </div>
  )
}
