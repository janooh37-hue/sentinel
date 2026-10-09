import type { SealTone } from '../bookStateLabel'

export type StationTone = 'navy' | 'amber' | 'green' | 'red' | 'blue'

export const TONE: Record<StationTone, { bg: string; fg: string }> = {
  navy: { bg: 'var(--primary-soft)', fg: 'var(--primary)' },
  amber: { bg: 'var(--warning-soft)', fg: 'var(--warning)' },
  green: { bg: 'var(--success-soft)', fg: 'var(--success)' },
  red: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  blue: { bg: 'var(--info-soft)', fg: 'var(--info)' },
}

// sealDescriptor tone → this page's Station tone vocabulary.
export const SEAL_TO_STATION_TONE: Record<SealTone, StationTone> = {
  neutral: 'navy',
  warning: 'amber',
  success: 'green',
  accent: 'red',
  info: 'blue',
}
