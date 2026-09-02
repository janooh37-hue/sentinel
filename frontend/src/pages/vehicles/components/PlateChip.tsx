/**
 * PlateChip — a number plate the way the paperwork writes it: `14 \ 58216`.
 *
 * The plate is a left-to-right run of digits and a separator. Inside an Arabic
 * (RTL) paragraph the bidi algorithm would otherwise reorder it to
 * `58216 \ 14`, so the chip isolates it with `<bdi dir="ltr">` — the same
 * treatment the duty register applies to clock ranges.
 */

import { cn } from '@/lib/utils'

interface Props {
  /** Pre-built label (`plate_label` from the API, or `plateLabel(vehicle)`). */
  plate: string
  /** `md` is the table/card default; `lg` heads the vehicle file. */
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZES = {
  sm: 'min-w-[68px] px-1.5 py-0.5 text-[0.68em]',
  md: 'min-w-[88px] px-2 py-1 text-[0.73em]',
  lg: 'min-w-[104px] px-2.5 py-1.5 text-[0.9em]',
} as const

export function PlateChip({ plate, size = 'md', className }: Props): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-lg border border-border-strong bg-surface-raised',
        'font-mono font-semibold tabular-nums text-primary',
        SIZES[size],
        className,
      )}
    >
      <bdi dir="ltr">{plate}</bdi>
    </span>
  )
}
