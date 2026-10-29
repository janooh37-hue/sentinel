import type { AdminUserRead } from '@/lib/api'
import { normalizeSearchText } from '@/lib/recipientMatch'
import type { ResourceSearchProps, StudioDestination } from '../contracts'
import { employeeNameScore, EMPLOYEE_NAME_MATCH_THRESHOLD } from './employeeNameScore'

export interface SearchEntry {
  key: string
  label: string
  alternateLabel: string
  identifiers: string[]
  numericIdentifiers?: string[]
  email?: string
  text: string[]
  aliases: string[]
  destination: StudioDestination
}
export interface SearchMatch { entry: SearchEntry; rank: number; suggestion: boolean }

export function accountSearchIndex(accounts: AdminUserRead[], arabic = false): SearchEntry[] {
  return accounts.map((account) => {
    // The enriched authorized account projection is supplied by the caller.
    const arabicName = 'name_ar' in account && typeof account.name_ar === 'string' ? account.name_ar : ''
    const label = (arabic && arabicName) || account.display_name || account.name_en || account.email
    const alternate = arabic ? account.name_en || account.display_name || '' : arabicName
    const employeeNumber = account.employee_id?.match(/^G(\d+)$/i)?.[1]
    return {
      key: `account:${account.id}`,
      label,
      alternateLabel: alternate === label ? '' : alternate,
      identifiers: [account.email, account.employee_id ?? ''],
      numericIdentifiers: employeeNumber ? [employeeNumber] : [],
      email: account.email,
      text: [account.display_name ?? '', account.name_en ?? '', arabicName],
      aliases: [],
      destination: { userId: account.id },
    }
  })
}

export function resourceSearchIndex({ subjectId, items }: ResourceSearchProps, arabic: boolean, actionLabels: (action: string) => string[] = () => []): SearchEntry[] {
  return items.flatMap((item) => item.actions.map((decision: ResourceSearchProps['items'][number]['actions'][number]) => ({
    key: `${item.resource.kind}:${item.resource.id}:${decision.action}`,
    label: arabic ? item.label.ar : item.label.en,
    alternateLabel: arabic ? item.label.en : item.label.ar,
    identifiers: [item.resource.id, `${item.resource.kind}:${item.resource.id}:${decision.action}`, ...decision.setting_capabilities],
    text: [item.label.en, item.label.ar, item.description.en, item.description.ar, decision.action, ...actionLabels(decision.action)],
    aliases: [...item.aliases.en, ...item.aliases.ar],
    destination: { userId: subjectId, resource: item.resource, action: decision.action },
  })))
}

/** Tiered matching keeps strict Arabic ahead of relaxed spelling and suggestions. */
export function searchEntries(entries: SearchEntry[], query: string): SearchMatch[] {
  const q = normalizeSearchText(query)
  if (!q) return []
  const relaxed = normalizeSearchText(query, true)
  const tokens = q.split(' ')
  const numeric = /\d/.test(q)
  const matches: SearchMatch[] = []
  for (const entry of entries) {
    const ids = [...entry.identifiers, ...entry.numericIdentifiers ?? []].map((value) => normalizeSearchText(value)).filter(Boolean)
    const texts = entry.text.map((value) => normalizeSearchText(value)).filter(Boolean)
    const aliases = entry.aliases.map((value) => normalizeSearchText(value)).filter(Boolean)
    let rank = Infinity
    if (ids.includes(q)) rank = 0
    // Digit-bearing queries may match complete identifier tokens, never partial numbers.
    else if (numeric) {
      const completeTokens = [...ids, ...texts, ...aliases].flatMap((value) => value.split(/[^\p{L}\p{N}@._-]+/u))
      if (tokens.every((token) => completeTokens.includes(token))) rank = 2
      else if (entry.email && /[\p{L}@.]/u.test(q)) {
        const email = normalizeSearchText(entry.email)
        // Email prefixes are text discovery; do not match a partial digit run.
        if (email.startsWith(q) && !(/\d$/.test(q) && /\d/.test(email[q.length] ?? ''))) rank = 2
      }
    } else if (texts.includes(q)) rank = 1
    else if ([...texts, ...ids].some((value) => value.startsWith(q)) || tokens.every((token) => texts.some((value) => value.split(' ').some((word) => word.startsWith(token))))) rank = 2
    else if (texts.some((value) => value.includes(q))) rank = 3
    else if (aliases.some((value) => value.includes(q))) rank = 4
    else if ([...texts, ...aliases].some((value) => normalizeSearchText(value, true).includes(relaxed))) rank = 5
    else {
      const score = Math.max(0, ...texts.map((value) => employeeNameScore(q, value)))
      if (score >= EMPLOYEE_NAME_MATCH_THRESHOLD) rank = 6 + (100 - score) / 100
    }
    if (Number.isFinite(rank)) matches.push({ entry, rank, suggestion: rank >= 6 })
  }
  return matches.sort((a, b) => a.rank - b.rank || a.entry.key.localeCompare(b.entry.key, 'en'))
}
