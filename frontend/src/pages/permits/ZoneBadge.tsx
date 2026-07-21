/**
 * ZoneBadge — a permit's zone as a badge.
 *
 * green → success tone, red → destructive tone. "Both" is deliberately NOT a
 * single unrelated hue: it renders a neutral pill carrying one green and one
 * red dot so it reads as "green AND red zone" at a glance.
 */
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import type { PermitZone } from '@/lib/api'
import { zoneTone } from './permitUtils'

interface Props {
  zone: PermitZone
  /** Square corners for the dense table; pill (default) elsewhere. */
  square?: boolean
  /** Full label ("Green zone") vs short ("Green"). */
  full?: boolean
}

export function ZoneBadge({ zone, square = false, full = false }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const shape = square ? 'square' : 'pill'
  const label = t(full ? `permits.zone.${zone}` : `permits.zone.${zone}Short`)

  if (zone === 'both') {
    return (
      <Badge tone="neutral" shape={shape} className="ps-1.5">
        <span className="inline-flex items-center gap-0.5" aria-hidden>
          <span className="h-[7px] w-[7px] rounded-full bg-success" />
          <span className="h-[7px] w-[7px] rounded-full bg-destructive" />
        </span>
        {label}
      </Badge>
    )
  }

  return (
    <Badge tone={zoneTone(zone)} shape={shape}>
      {label}
    </Badge>
  )
}
