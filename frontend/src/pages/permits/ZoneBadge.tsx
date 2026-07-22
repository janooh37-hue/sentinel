/**
 * ZoneBadge — a permit's zones as one badge per zone.
 *
 * green → success (green), red → destructive (red), work_residence → info
 * (blue). A permit can carry any combination, so this renders one small chip
 * per zone rather than a single mixed pill.
 */
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import type { PermitZone } from '@/lib/api'
import { zoneTone } from './permitUtils'

interface Props {
  zones: PermitZone[]
  /** Square corners for the dense table; pill (default) elsewhere. */
  square?: boolean
  /** Full label ("Work residence") vs short ("Work res."). */
  full?: boolean
}

export function ZoneBadge({ zones, square = false, full = false }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const shape = square ? 'square' : 'pill'
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {zones.map((zone) => (
        <Badge key={zone} tone={zoneTone(zone)} shape={shape}>
          {t(full ? `permits.zone.${zone}` : `permits.zone.${zone}Short`)}
        </Badge>
      ))}
    </span>
  )
}
