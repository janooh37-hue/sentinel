import { useTranslation } from 'react-i18next'

import type { ArmoryActorRead, ArmoryQualificationRead, ArmorySerialRead } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'

export type ArmorySerialState = NonNullable<ArmorySerialRead['state']>
export type ArmoryLicenceStatus = ArmoryQualificationRead['licence_status']

/** Organization zone (SPEC rule 8). Prefer `window.time_zone` from a read when one is at hand. */
export const ARMORY_TIME_ZONE = 'Asia/Dubai'

/** Translation key for a serial state; one status language on every surface (shared enum keys). */
export function serialStateKey(state: ArmorySerialState): string {
  return `assets.armory.serialState.${state}`
}

export function licenceStatusKey(status: ArmoryLicenceStatus): string {
  return `assets.armory.licenceStatus.${status}`
}

/** The recorded employee name, then the account's friendly name. */
export function actorName(actor: ArmoryActorRead | null | undefined, language: string): string | null {
  if (!actor) return null
  if (actor.employee) return pickEmployeeName(actor.employee, language)
  return actor.display_name?.trim() || null
}

function parts(iso: string, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  return Object.fromEntries(formatter.formatToParts(new Date(iso)).map(part => [part.type, part.value]))
}

/** `HH:MM` (24-hour) of an instant in organization time. */
export function orgTime(iso: string, timeZone = ARMORY_TIME_ZONE): string {
  const p = parts(iso, timeZone)
  return `${p.hour}:${p.minute}`
}

/** `YYYY-MM-DD` organization date of an instant. */
export function orgDateIso(iso: string, timeZone = ARMORY_TIME_ZONE): string {
  const p = parts(iso, timeZone)
  return `${p.year}-${p.month}-${p.day}`
}

/** `DD/MM/YYYY` for a date-only value (`YYYY-MM-DD`). */
export function displayDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return y && m && d ? `${d}/${m}/${y}` : isoDate
}

/** `DD/MM/YYYY HH:MM` in organization time. */
export function orgDateTime(iso: string, timeZone = ARMORY_TIME_ZONE): string {
  return `${displayDate(orgDateIso(iso, timeZone))} ${orgTime(iso, timeZone)}`
}

/** Value for `<input type="datetime-local">` in organization time (`YYYY-MM-DDTHH:MM`). */
export function orgDateTimeInput(iso: string, timeZone = ARMORY_TIME_ZONE): string {
  return `${orgDateIso(iso, timeZone)}T${orgTime(iso, timeZone)}`
}

/**
 * Converts a `YYYY-MM-DDTHH:MM` organization-local value to an instant with
 * its offset (`+04:00` for Asia/Dubai), as `ArmoryShiftIssueCreate.due_at` needs.
 */
export function orgInputToInstant(value: string, timeZone = ARMORY_TIME_ZONE): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, y, mo, d, h, mi] = match.map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const shown = parts(new Date(guess).toISOString(), timeZone)
  const shownUtc = Date.UTC(Number(shown.year), Number(shown.month) - 1, Number(shown.day), Number(shown.hour), Number(shown.minute))
  const offsetMinutes = Math.round((shownUtc - guess) / 60_000)
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  return `${value}:00${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

/** Locale helpers bound to the current UI language. */
export function useArmoryLocale() {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  return {
    t,
    isAr,
    /** Catalogue, safe or person name in the UI language (falls back to English when Arabic is absent). */
    name: (value: { name_en: string; name_ar?: string | null }): string => (isAr && value.name_ar?.trim() ? value.name_ar : value.name_en),
    /** Elapsed minutes as "Overdue by 1 h 5 min". */
    overdue: (minutes: number): string => {
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      const duration = [hours ? t('assets.armory.elapsedHours', { count: hours }) : '', rest || !hours ? t('assets.armory.elapsedMinutes', { count: rest }) : ''].filter(Boolean).join(' ')
      return t('assets.armory.overdueBy', { duration })
    },
  }
}
