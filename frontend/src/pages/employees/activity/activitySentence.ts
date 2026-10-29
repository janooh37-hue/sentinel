/**
 * Plain-language wording for the Activity statement: one sentence per entry,
 * one summary sentence for the period, and the fact list shown on expand.
 * Everything is built from real fields; nothing is invented. Sentences carry
 * `<b>` markers around the actor and the object; `ActivityRich` renders them.
 */

import type { TFunction } from 'i18next'

import { splitBilingual } from '@/lib/bilingualValue'
import { displayViolationValue } from '@/lib/violationTypes'

import { formatStatementDate, statementLocale } from '../statement/statementModel'
import type { ActivityStatementItem } from '../statement/statementTypes'

/** Strip the markup characters so a value can never open or close a `<b>`. */
function clean(value: string): string {
  return value.replace(/[<>]/g, '')
}

export function isArabic(language: string): boolean {
  return language.startsWith('ar')
}

export function documentName(item: ActivityStatementItem, language: string): string {
  const ar = item.template_name_ar
  const en = item.template_name_en
  return (isArabic(language) ? ar ?? en : en ?? ar) ?? item.template_id ?? ''
}

export function leaveTypeLabel(value: string, t: TFunction, language: string): string {
  return t(`leaves.type.${value}`, { defaultValue: splitBilingual(value, language) })
}

function leaveDetail(item: ActivityStatementItem, t: TFunction, language: string): string {
  const range =
    item.start_date && item.end_date
      ? t('activityStatement.sentence.leaveRange', {
          from: formatStatementDate(item.start_date, language, false),
          to: formatStatementDate(item.end_date, language),
        })
      : ''
  if (item.days === null) return range
  const days = t('activityStatement.sentence.leaveDays', { count: item.days })
  return range ? t('activityStatement.sentence.leaveDetail', { days, range }) : days
}

/**
 * The entry sentence for the kinds that read as prose. Placement and status
 * entries return null: they render through `DutyLocationActivity` and
 * `StatusActivity` so their wording stays in one place.
 */
export function entrySentence(item: ActivityStatementItem, t: TFunction, language: string): string | null {
  const actor = item.actor_name ? clean(item.actor_name) : null
  const key = (name: string): string => `activityStatement.sentence.${name}${actor ? '' : 'NoActor'}`
  const base = { actor: actor ?? '' }
  switch (item.kind) {
    case 'document':
      return t(key('document'), { ...base, name: clean(documentName(item, language)) })
    case 'leave':
      return t(key('leave'), {
        ...base,
        type: clean(leaveTypeLabel(item.leave_type ?? '', t, language)),
        detail: clean(leaveDetail(item, t, language)),
      })
    case 'violation':
      return t(key('violation'), {
        ...base,
        type: clean(displayViolationValue(item.violation_type ?? '', isArabic(language))),
      })
    case 'ledger': {
      const subject = clean(item.subject ?? '')
      const party = item.counterparty ? clean(item.counterparty) : null
      if (item.direction === 'incoming' || item.direction === 'outgoing') {
        const side = item.direction === 'incoming' ? 'ledgerIncoming' : 'ledgerOutgoing'
        return t(key(side), {
          ...base,
          subject,
          party: party ? t(`activityStatement.sentence.${side}Party`, { name: party }) : '',
        })
      }
      return t(key('ledgerOther'), { ...base, subject })
    }
    case 'absence':
      return t(key('absence'), {
        ...base,
        note: item.note ? t('activityStatement.sentence.absenceNote', { note: clean(item.note) }) : '',
      })
    case 'duty_location':
    case 'status':
      return null
  }
}

export interface Fact {
  label: string
  value: string
}

/** Detail rows for the expanded entry. Only fields that are present. */
export function entryFacts(item: ActivityStatementItem, t: TFunction, language: string): Fact[] {
  const facts: Fact[] = []
  const add = (label: string, value: string | number | null | undefined): void => {
    if (value === null || value === undefined || value === '') return
    facts.push({ label: t(`activityStatement.fact.${label}`), value: String(value) })
  }
  switch (item.kind) {
    case 'document':
      add('document', documentName(item, language))
      break
    case 'leave':
      add('type', leaveTypeLabel(item.leave_type ?? '', t, language))
      add('days', item.days)
      add('from', item.start_date && formatStatementDate(item.start_date, language))
      add('to', item.end_date && formatStatementDate(item.end_date, language))
      add('status', item.leave_status && t(`leaves.status.${item.leave_status}`, { defaultValue: item.leave_status }))
      break
    case 'violation':
      add('type', displayViolationValue(item.violation_type ?? '', isArabic(language)))
      add('description', item.description)
      add('actionTaken', item.action_taken)
      add('deductionDays', item.deduction_days)
      add('status', item.violation_status && t(`violations.status.${item.violation_status}`, { defaultValue: item.violation_status }))
      break
    case 'ledger':
      add('subject', item.subject)
      add('direction', item.direction && t(`activityStatement.direction.${item.direction}`, { defaultValue: item.direction }))
      add('channel', item.channel)
      add('counterparty', item.counterparty)
      break
    case 'absence':
      add('note', item.note)
      break
    case 'duty_location':
      add('fromDepartment', item.from_department)
      add('toDepartment', item.to_department)
      add('reason', item.reason)
      break
    case 'status':
      add('site', item.site)
      break
  }
  return facts
}

export interface ActivityCounts {
  leave: number
  leaveDays: number
  violation: number
  absence: number
  document: number
  ledger: number
  transfer: number
  status: number
}

export function countActivity(items: readonly ActivityStatementItem[]): ActivityCounts {
  const counts: ActivityCounts = {
    leave: 0,
    leaveDays: 0,
    violation: 0,
    absence: 0,
    document: 0,
    ledger: 0,
    transfer: 0,
    status: 0,
  }
  for (const item of items) {
    switch (item.kind) {
      case 'leave':
        counts.leave += 1
        counts.leaveDays += item.days ?? 0
        break
      case 'duty_location':
        if (item.event_type === 'transfer') counts.transfer += 1
        break
      default:
        counts[item.kind] += 1
    }
  }
  return counts
}

/** "3 leaves totalling 33 days, 2 violations and 1 absence." Zero categories are omitted. */
export function summarySentence(counts: ActivityCounts, t: TFunction, language: string): string {
  const parts: string[] = []
  if (counts.leave > 0) {
    parts.push(
      t('activityStatement.summary.leave', {
        count: counts.leave,
        days: t('activityStatement.sentence.leaveDays', { count: counts.leaveDays }),
      }),
    )
  }
  for (const name of ['violation', 'absence', 'document', 'ledger', 'transfer', 'status'] as const) {
    if (counts[name] > 0) parts.push(t(`activityStatement.summary.${name}`, { count: counts[name] }))
  }
  if (parts.length === 0) return t('activityStatement.summary.empty')
  const list = new Intl.ListFormat(statementLocale(language), { style: 'long', type: 'conjunction' }).format(parts)
  return t('activityStatement.summary.sentence', { list })
}
