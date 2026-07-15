import type { EmployeeListItem } from '@/lib/api'

export function buildMention(
  emp: EmployeeListItem,
  lang: string,
  includeDesignation: boolean,
): string {
  const ar = lang.startsWith('ar')
  const name = (ar ? emp.name_ar : emp.name_en) || emp.name_en || emp.name_ar || emp.id
  let out = `${name} (${emp.id})`
  if (includeDesignation) {
    const desig = (ar ? emp.position_ar : emp.position) || emp.position || emp.position_ar
    if (desig) out += ar ? `، ${desig}` : `, ${desig}`
  }
  return out
}

export interface MentionTarget {
  name: string
  number: string
}

/** Mirror of backend openwa_client.mention_chat_ids digit rules. */
export function mentionDigits(raw: string): string {
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0') && d.length >= 9) d = '971' + d.slice(1)
  // Bare 9-digit local mobile (5xxxxxxxx) — how most employee contacts are
  // stored; without 971 WhatsApp can't resolve the mention.
  else if (d.startsWith('5') && d.length === 9) d = '971' + d
  return d
}

/**
 * Rewrite "@Name" tokens to "@<digits>" (what WhatsApp needs for a real
 * mention) and collect the numbers to send alongside. Mentions whose token
 * no longer appears (operator edited it out) or whose number is unusable
 * are silently skipped — the literal text still delivers.
 */
export function applyMentions(
  text: string,
  mentions: MentionTarget[],
): { text: string; numbers: string[] } {
  let out = text
  const numbers: string[] = []
  const ordered = [...mentions].sort((a, b) => b.name.length - a.name.length)
  for (const m of ordered) {
    const token = `@${m.name}`
    if (!out.includes(token)) continue
    const digits = mentionDigits(m.number)
    if (!digits) continue
    out = out.split(token).join(`@${digits}`)
    if (!numbers.includes(digits)) numbers.push(digits)
  }
  return { text: out, numbers }
}

/** Split message text into parts so previews can paint "@Name" in WA blue. */
export function splitMentionParts(
  text: string,
  names: string[],
): Array<{ kind: 'text' | 'mention'; value: string }> {
  const tokens = names.map((n) => `@${n}`).sort((a, b) => b.length - a.length)
  const parts: Array<{ kind: 'text' | 'mention'; value: string }> = []
  let rest = text
  while (rest.length > 0) {
    let hitIdx = -1
    let hitToken = ''
    for (const tok of tokens) {
      const i = rest.indexOf(tok)
      if (i !== -1 && (hitIdx === -1 || i < hitIdx)) {
        hitIdx = i
        hitToken = tok
      }
    }
    if (hitIdx === -1) {
      parts.push({ kind: 'text', value: rest })
      break
    }
    if (hitIdx > 0) parts.push({ kind: 'text', value: rest.slice(0, hitIdx) })
    parts.push({ kind: 'mention', value: hitToken })
    rest = rest.slice(hitIdx + hitToken.length)
  }
  return parts
}
