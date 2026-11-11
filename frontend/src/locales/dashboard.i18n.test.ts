import { expect, it } from 'vitest'
import i18n from '@/lib/i18n'
import en from './en.json'
import ar from './ar.json'

const months = 'dashboard.widgets.violation_months.monthsOpen'
const records = 'dashboard.widgets.on_leave_today.records'
const changes = 'dashboard.widgets.sent_approvals.needsChanges'

it.each([
  [1, 'month open', 'leave record', '1 needs changes'],
  [2, 'months open', 'leave records', '2 need changes'],
] as const)('pluralizes English dashboard counts for %i', (count, monthLabel, recordLabel, changeLabel) => {
  expect(i18n.t(months, { lng: 'en', count })).toBe(monthLabel)
  expect(i18n.t(records, { lng: 'en', count })).toBe(recordLabel)
  expect(i18n.t(changes, { lng: 'en', count })).toBe(changeLabel)
})

it.each([
  [0, 'أشهر مفتوحة', 'سجلات إجازة', 'لا سجلات تحتاج إلى تعديل'],
  [1, 'شهر مفتوح', 'سجل إجازة', 'سجل واحد يحتاج إلى تعديل'],
  [2, 'شهران مفتوحان', 'سجلا إجازة', 'سجلان يحتاجان إلى تعديل'],
  [3, 'أشهر مفتوحة', 'سجلات إجازة', '3 سجلات تحتاج إلى تعديل'],
  [11, 'شهرًا مفتوحًا', 'سجل إجازة', '11 سجلًا يحتاج إلى تعديل'],
  [100, 'شهر مفتوح', 'سجل إجازة', '100 سجل يحتاج إلى تعديل'],
] as const)('pluralizes Arabic dashboard counts for %i', (count, monthLabel, recordLabel, changeLabel) => {
  expect(i18n.t(months, { lng: 'ar', count })).toBe(monthLabel)
  expect(i18n.t(records, { lng: 'ar', count })).toBe(recordLabel)
  expect(i18n.t(changes, { lng: 'ar', count })).toBe(changeLabel)
})

it('preserves both branches’ dashboard keys with English/Arabic parity', () => {
  expect(Object.keys(en.dashboard.quickActionDesc).sort()).toEqual(Object.keys(ar.dashboard.quickActionDesc).sort())
  expect(en.dashboard.workspace.unavailable).toBe('Not available')
  expect(ar.dashboard.workspace.unavailable).toBe('غير متاح')
  for (const key of ['title', 'syncing', 'syncSuccess', 'syncError'] as const) {
    expect(en.dashboard.widgets.ledger[key]).toBeTruthy()
    expect(ar.dashboard.widgets.ledger[key]).toBeTruthy()
  }
})

it('keeps store widget translations and source labels in both languages', () => {
  for (const id of ['store_expiring', 'store_low_stock'] as const) {
    expect(Object.keys(en.dashboard.widgets[id]).sort()).toEqual(Object.keys(ar.dashboard.widgets[id]).sort())
    for (const lng of ['en', 'ar']) {
      for (const key of Object.keys(en.dashboard.widgets[id])) {
        expect(i18n.exists(`dashboard.widgets.${id}.${key}`, { lng })).toBe(true)
      }
    }
  }
  expect(en.dashboard.customize.sources.store).toBe('Store')
  expect(ar.dashboard.customize.sources.store).toBe('المخزن')
})
