/**
 * FineAmount — a fine's exact fils amount with the official dirham mark.
 *
 * Money is a left-to-right run of Latin digits even inside an Arabic
 * paragraph (`<bdi dir="ltr">`, the same treatment `PlateChip` and clock
 * ranges use), and the digits stay decorative — a screen reader gets one
 * localized currency sentence instead of the icon glyph plus a bare number.
 * The dirham asset is a single-color glyph recolored to the caller's current
 * text color via a CSS mask, so it reads correctly on any tone (muted,
 * warning, on dark surfaces) without a separate light/dark asset.
 */

import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import dirhamMark from '../../../assets/dirham-symbol.png'
import { formatFilsAed, formatFilsNumber } from '../vehicleUtils'

const SIZES = {
  sm: 'text-[0.76rem]',
  md: 'text-[0.86rem]',
  lg: 'text-[1.05rem]',
} as const

interface Props {
  /** Exact integer fils (1/100 AED). */
  fils: number
  size?: keyof typeof SIZES
  className?: string
}

export function FineAmount({ fils, size = 'md', className }: Props): React.JSX.Element {
  const { i18n } = useTranslation()
  const label = formatFilsAed(fils, i18n.language)

  return (
    <bdi
      dir="ltr"
      className={cn('inline-flex items-center gap-1 font-mono font-semibold', SIZES[size], className)}
    >
      <span
        aria-hidden="true"
        className="inline-block h-[0.85em] w-[0.85em] shrink-0 bg-current"
        style={{
          maskImage: `url(${dirhamMark})`,
          maskRepeat: 'no-repeat',
          maskSize: 'contain',
          maskPosition: 'center',
          WebkitMaskImage: `url(${dirhamMark})`,
          WebkitMaskRepeat: 'no-repeat',
          WebkitMaskSize: 'contain',
          WebkitMaskPosition: 'center',
        }}
      />
      <span aria-hidden="true" className="tabular-nums">
        {formatFilsNumber(fils)}
      </span>
      <span className="sr-only">{label}</span>
    </bdi>
  )
}
