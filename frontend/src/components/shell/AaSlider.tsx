/**
 * AaSlider — small `A · slider · A` control that lets the operator pick a
 * font scale by snapping to one of the discrete stops in `FONT_SCALE_STOPS`
 * (currently [16, 19, 22, 24] px). Wired in TopNav to the `font_scale`
 * AppSetting. Clamps out-of-range incoming values so a corrupt setting
 * never blows up the UI.
 *
 * The small "A" and big "A" framing letters are clickable: clicking the
 * small A decrements one stop (toward smallest), clicking the big A
 * increments one stop (toward largest). The middle range slider keeps
 * working as before for drag interaction.
 */

import { useCallback } from 'react'

import { FONT_SCALE_STOPS, snapFontScale } from '@/lib/theme'
import { cn } from '@/lib/utils'

export interface AaSliderProps {
  value: number
  onChange: (next: number) => void
}

export function AaSlider({ value, onChange }: AaSliderProps): React.JSX.Element {
  const stops = FONT_SCALE_STOPS as readonly number[]
  const snapped = snapFontScale(value)
  const index = Math.max(0, stops.indexOf(snapped))
  const maxIndex = stops.length - 1
  const handle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const idx = parseInt(e.target.value, 10)
      const clampedIdx = Math.max(0, Math.min(maxIndex, idx))
      onChange(stops[clampedIdx])
    },
    [onChange, maxIndex, stops],
  )
  const decrement = useCallback(() => {
    if (index <= 0) return
    onChange(stops[index - 1])
  }, [index, onChange, stops])
  const increment = useCallback(() => {
    if (index >= maxIndex) return
    onChange(stops[index + 1])
  }, [index, maxIndex, onChange, stops])
  const atMin = index <= 0
  const atMax = index >= maxIndex
  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-surface-tinted px-3 py-1.5">
      <button
        type="button"
        onClick={decrement}
        disabled={atMin}
        aria-label="Decrease text size"
        className={cn(
          'rounded-md px-1 py-0.5 text-[0.78em] font-semibold leading-none text-muted-foreground transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface-tinted',
          !atMin && 'hover:bg-surface hover:text-foreground',
          atMin && 'cursor-not-allowed opacity-40',
        )}
      >
        A
      </button>
      <input
        type="range"
        min={0}
        max={maxIndex}
        step={1}
        value={index}
        onChange={handle}
        aria-label="Text size"
        aria-valuemin={stops[0]}
        aria-valuemax={stops[maxIndex]}
        aria-valuenow={snapped}
        className="aa-slider h-1 w-[100px] cursor-pointer appearance-none rounded-full bg-border"
      />
      <button
        type="button"
        onClick={increment}
        disabled={atMax}
        aria-label="Increase text size"
        className={cn(
          'rounded-md px-1 py-0.5 text-[1.15em] font-bold leading-none text-foreground transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface-tinted',
          !atMax && 'hover:bg-surface',
          atMax && 'cursor-not-allowed opacity-40',
        )}
      >
        A
      </button>
    </div>
  )
}
