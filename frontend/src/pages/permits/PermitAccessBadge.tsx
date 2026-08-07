import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import type { PermitAccessAreas, PermitLocationZone, PermitZone } from '@/lib/api'
import { zoneTone, type Tone } from './permitUtils'

type Location = 'al_wathba_1' | 'al_wathba_2'

const LOCATIONS: Location[] = ['al_wathba_1', 'al_wathba_2']
const LOCATION_ZONES: PermitLocationZone[] = ['green', 'red']

interface Props {
  accessAreas: PermitAccessAreas | null | undefined
  zones: readonly PermitZone[]
  /** Square corners for the dense register and print views. */
  square?: boolean
  /** Full location and zone labels instead of compact labels. */
  full?: boolean
}

export function PermitAccessBadge({
  accessAreas,
  zones,
  square = false,
  full = false,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const shape = square ? 'square' : 'pill'
  const entries: Array<{ key: string; tone: Tone; label: string }> = []

  if (accessAreas == null) {
    for (const zone of LOCATION_ZONES) {
      if (zones.includes(zone)) {
        entries.push({
          key: `unspecified-${zone}`,
          tone: zoneTone(zone),
          label: t('permits.access.pair', {
            location: t(`permits.location.unspecified${full ? '' : 'Short'}`),
            zone: t(`permits.zone.${zone}${full ? '' : 'Short'}`),
          }),
        })
      }
    }
    if (zones.includes('work_residence')) {
      entries.push({
        key: 'work-residence',
        tone: zoneTone('work_residence'),
        label: t(`permits.zone.work_residence${full ? '' : 'Short'}`),
      })
    }
  } else {
    for (const location of LOCATIONS) {
      for (const zone of LOCATION_ZONES) {
        if (accessAreas[location]?.includes(zone)) {
          entries.push({
            key: `${location}-${zone}`,
            tone: zoneTone(zone),
            label: t('permits.access.pair', {
              location: t(`permits.location.${location}${full ? '' : 'Short'}`),
              zone: t(`permits.zone.${zone}${full ? '' : 'Short'}`),
            }),
          })
        }
      }
    }
    if (accessAreas.work_residence) {
      entries.push({
        key: 'work-residence',
        tone: zoneTone('work_residence'),
        label: t(`permits.zone.work_residence${full ? '' : 'Short'}`),
      })
    }
  }

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1">
      {entries.map((entry) => (
        <Badge key={entry.key} tone={entry.tone} shape={shape}>
          {entry.label}
        </Badge>
      ))}
    </span>
  )
}
