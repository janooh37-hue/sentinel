/** Display and validation helpers shared by the Organization & departments views. */

import type { TFunction } from 'i18next'
import { z } from 'zod'

import type { OrgNodeRead } from '@/lib/api'

export function personPosition(person: OrgNodeRead, language: string): string | null {
  return language.startsWith('ar') && person.position_ar?.trim() ? person.position_ar : person.position
}

export function matchesPerson(person: OrgNodeRead, term: string): boolean {
  const needle = term.trim().toLocaleLowerCase()
  return !needle || [person.id, person.name_en, person.name_ar, person.position, person.position_ar]
    .some((value) => value?.toLocaleLowerCase().includes(needle))
}

export function serviceLabel(service: { label_en: string; label_ar: string }, language: string): string {
  return language.startsWith('ar') ? service.label_ar || service.label_en : service.label_en || service.label_ar
}

export type DraftNames = { name_en: string; name_ar: string }

export function draftNamesSchema(t: TFunction) {
  const name = z.string().trim()
    .min(1, t('orgDepartments.form.nameRequired'))
    .max(128, t('orgDepartments.form.nameTooLong'))
  return z.object({ name_en: name, name_ar: name })
}

const ARABIC = /[\u0600-\u06FF]/

/** Labels already on the head's record, in the field's own script. Never a translation. */
export function nameSuggestions(person: OrgNodeRead, field: keyof DraftNames): string[] {
  const values = field === 'name_ar'
    ? [person.duty_unit, person.position_ar, person.duty_post, person.position]
    : [person.duty_unit, person.position, person.duty_post]
  const wantArabic = field === 'name_ar'
  return [...new Set(values.map((value) => value?.trim() ?? '').filter((value) => value && ARABIC.test(value) === wantArabic))].slice(0, 3)
}
