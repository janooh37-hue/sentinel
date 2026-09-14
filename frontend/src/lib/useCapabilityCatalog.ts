import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { api, type CapabilityRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'

const ROLES = new Set(['operator', 'manager', 'admin'])
const EMPTY_CATALOG: readonly CapabilityRead[] = []

function invalidCatalog(): never {
  throw new Error('Invalid capability catalog response')
}

function validateCatalog(value: unknown): CapabilityRead[] {
  if (!Array.isArray(value)) invalidCatalog()
  const seen = new Set<string>()
  const entries: CapabilityRead[] = []
  for (const valueEntry of value) {
    if (valueEntry === null || typeof valueEntry !== 'object') invalidCatalog()
    const entry = valueEntry as Record<string, unknown>
    if (
      typeof entry.id !== 'string' ||
      !entry.id.trim() ||
      seen.has(entry.id) ||
      typeof entry.domain !== 'string' ||
      typeof entry.label_en !== 'string' ||
      !(entry.label_ar === null || typeof entry.label_ar === 'string') ||
      typeof entry.description_en !== 'string' ||
      !(entry.description_ar === null || typeof entry.description_ar === 'string') ||
      typeof entry.sensitive !== 'boolean' ||
      typeof entry.requestable !== 'boolean' ||
      !Array.isArray(entry.default_roles) ||
      !entry.default_roles.every((role) => typeof role === 'string' && ROLES.has(role)) ||
      (entry.sensitive && entry.requestable)
    ) {
      invalidCatalog()
    }
    seen.add(entry.id)
    entries.push(valueEntry as CapabilityRead)
  }
  return entries
}

export const capabilityCatalogKey = (userId: number) =>
  ['capability-catalog', userId] as const

export type CapabilityRequestState =
  | { kind: 'loading'; entry: null }
  | { kind: 'error'; entry: null }
  | { kind: 'unknown'; entry: null }
  | { kind: 'not_requestable'; entry: CapabilityRead }
  | { kind: 'requestable'; entry: CapabilityRead }

export interface LocalizedCapabilityText {
  label: string
  description: string
  labelIsIdentifier: boolean
}

export function localizeCapability(
  entry: CapabilityRead | undefined,
  id: string,
  language: string,
): LocalizedCapabilityText {
  const arabic = language.toLowerCase().startsWith('ar')
  const label = arabic
    ? entry?.label_ar?.trim() || entry?.label_en.trim() || id
    : entry?.label_en.trim() || id
  const description = arabic
    ? entry?.description_ar?.trim() || entry?.description_en.trim() || ''
    : entry?.description_en.trim() || ''
  return {
    label,
    description,
    labelIsIdentifier: label === id,
  }
}

export function isolateBidi(value: string): string {
  return `\u2068${value}\u2069`
}

export interface CapabilityCatalog {
  status: 'loading' | 'error' | 'ready'
  entries: readonly CapabilityRead[]
  byId: ReadonlyMap<string, CapabilityRead>
  requestState: (id: string) => CapabilityRequestState
}

export function useCapabilityCatalog(): CapabilityCatalog {
  const { status: authStatus, user } = useAuth()
  const query = useQuery({
    queryKey: capabilityCatalogKey(user?.id ?? 0),
    queryFn: async () => validateCatalog(await api.listCapabilities()),
    enabled: authStatus === 'authed' && user != null,
    staleTime: 5 * 60_000,
  })
  const entries = query.data ?? EMPTY_CATALOG
  const byId = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries],
  )
  const status = query.isError ? 'error' : query.isPending ? 'loading' : 'ready'

  return {
    status,
    entries,
    byId,
    requestState: (id: string): CapabilityRequestState => {
      if (status === 'loading') return { kind: 'loading', entry: null }
      if (status === 'error') return { kind: 'error', entry: null }
      const entry = byId.get(id)
      if (!entry) return { kind: 'unknown', entry: null }
      if (entry.sensitive || !entry.requestable) {
        return { kind: 'not_requestable', entry }
      }
      return { kind: 'requestable', entry }
    },
  }
}
