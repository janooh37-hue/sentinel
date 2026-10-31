/** Text clean-up rules for the printed statements: say each fact once, in the paper's language. */

import type { TFunction } from 'i18next'

import type { EmployeeRead } from '@/lib/api'

/** Actor names as printed: the literal `system` actor reads in the paper's language. */
export function paperActor(name: string | null | undefined, t: TFunction): string {
  if (!name) return ''
  return name.trim().toLowerCase() === 'system' ? t('statementPrint.paper.system') : name
}

const ARABIC = /[\u0600-\u06ff\u0750-\u077f\ufb50-\ufdff\ufe70-\ufeff]/
const LATIN = /[A-Za-z]/

/**
 * The script a free-text value is written in, as a `lang` tag, so the paper
 * sets it in the right family at a matching optical size. Mixed or neutral
 * text (digits, codes) gets no tag and inherits the paper's language.
 */
export function scriptLang(text: string | null | undefined): 'ar' | 'en' | undefined {
  if (!text) return undefined
  const ar = ARABIC.test(text)
  const en = LATIN.test(text)
  if (ar === en) return undefined
  return ar ? 'ar' : 'en'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A ledger subject without a trailing "<separator> <this employee's name>"
 * (separators ` — `, ` – `, ` - `; EN or AR name, case-insensitive): the
 * statement is already about this employee.
 */
export function stripOwnName(subject: string, employee: Pick<EmployeeRead, 'name_en' | 'name_ar'>): string {
  let out = subject
  for (const name of [employee.name_en, employee.name_ar]) {
    if (!name?.trim()) continue
    out = out.replace(new RegExp(`\\s+[—–-]\\s+${escapeRegExp(name.trim())}\\s*$`, 'i'), '')
  }
  return out.trim() || subject
}
