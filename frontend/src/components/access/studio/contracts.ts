import type { components } from '@/lib/api.types'

export type Resource = components['schemas']['Resource']
export type Action = components['schemas']['Action']
export type AccessItem = components['schemas']['AccessItem']

export type StudioDestination = { userId?: number; resource?: Resource; action?: Action }
export type ResourceSearchProps = {
  subjectId?: number
  items: AccessItem[]
  onNavigate: (destination: StudioDestination) => void
  onMatchesChange?: (resources: Resource[]) => void
}
