/**
 * RangeSlider — token-styled native range input. Dependency-free (same
 * approach as components/shell/AaSlider.tsx); no Radix slider needed.
 */
import { cn } from '@/lib/utils'

export interface RangeSliderProps {
  value: number
  min: number
  max: number
  step?: number
  onChange: (next: number) => void
  ariaLabel: string
  className?: string
}

export function RangeSlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
  className,
}: RangeSliderProps): React.JSX.Element {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn(
        'aa-slider h-1 w-full cursor-pointer appearance-none rounded-full bg-border',
        className,
      )}
    />
  )
}
