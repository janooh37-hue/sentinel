import { describe, expect, it } from 'vitest'

import i18n from '@/lib/i18n'
import ar from '@/locales/ar.json'
import en from '@/locales/en.json'

type Rec = Record<string, unknown>
type Strings = Record<string, string>

const EXTERNAL_KEYS = [
  'application.approvedViolation.monthlyStatistics',
  'application.approvedViolation.openRegister',
  'dashboard.widgetLabels.violation_months',
] as const
const EXPECTED_PLACEHOLDERS = [
  '{{count}}',
  '{{date}}',
  '{{derived}}',
  '{{manual}}',
  '{{months}}',
  '{{name}}',
  '{{ref}}',
  '{{rows}}',
  '{{tables}}',
]
const INTERPOLATION = /{{\w+}}/g

function get(o: Rec, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => (current as Rec)?.[key], o)
}

function flattenStrings(value: Rec, prefix: string): Strings {
  const result: Strings = {}
  for (const [key, child] of Object.entries(value)) {
    const path = `${prefix}.${key}`
    if (typeof child === 'string') result[path] = child
    else if (child && typeof child === 'object') {
      Object.assign(result, flattenStrings(child as Rec, path))
    }
  }
  return result
}

function featureStrings(locale: Rec): Strings {
  const inmateStats = get(locale, 'inmateStats') as Rec
  const result = flattenStrings(inmateStats, 'inmateStats')
  for (const path of EXTERNAL_KEYS) result[path] = get(locale, path) as string
  return result
}

// Arabic and English intentionally have different concrete CLDR plural leaves.
// Treat those leaves as one logical translation key for cross-locale parity;
// the exact required leaves are checked independently below.
function logicalKey(path: string): string {
  return path.replace(/^inmateStats\.awaiting\.rows_(?:one|two|few|many|other)$/, 'inmateStats.awaiting.rows')
}

function logicalKeys(strings: Strings): string[] {
  return [...new Set(Object.keys(strings).map(logicalKey))].sort()
}

function placeholdersFor(strings: Strings, key: string): string[] {
  return [
    ...new Set(
      Object.entries(strings)
        .filter(([path]) => logicalKey(path) === key)
        .flatMap(([, value]) => value.match(INTERPOLATION) ?? []),
    ),
  ].sort()
}

const EN = featureStrings(en as unknown as Rec)
const AR = featureStrings(ar as unknown as Rec)
const EN_KEYS = logicalKeys(EN)
const AR_KEYS = logicalKeys(AR)

const EN_ROW_FORMS = {
  'inmateStats.awaiting.rows_one': '{{count}} entry',
  'inmateStats.awaiting.rows_other': '{{count}} entries',
}
const AR_ROW_FORMS = {
  'inmateStats.awaiting.rows_one': 'سطر واحد',
  'inmateStats.awaiting.rows_two': 'سطران',
  'inmateStats.awaiting.rows_few': '{{count}} أسطر',
  'inmateStats.awaiting.rows_many': '{{count}} سطرًا',
  'inmateStats.awaiting.rows_other': '{{count}} سطر',
}

describe('inmate statistics i18n parity', () => {
  it('covers all 179 logical feature keys in both locales', () => {
    expect(EN_KEYS).toHaveLength(179)
    expect(AR_KEYS).toHaveLength(179)
  })

  it('has every logical key in both locales', () => {
    const onlyInEnglish = EN_KEYS.filter((key) => !AR_KEYS.includes(key))
    const onlyInArabic = AR_KEYS.filter((key) => !EN_KEYS.includes(key))
    expect({ onlyInEnglish, onlyInArabic }).toEqual({ onlyInEnglish: [], onlyInArabic: [] })
  })

  it('has no empty values in either locale', () => {
    const empty = [...Object.entries(EN), ...Object.entries(AR)]
      .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
      .map(([path]) => path)
    expect(empty).toEqual([])
  })

  it('uses the same interpolation placeholders in both languages', () => {
    const mismatches = EN_KEYS.flatMap((key) => {
      const english = placeholdersFor(EN, key)
      const arabic = placeholdersFor(AR, key)
      return JSON.stringify(english) === JSON.stringify(arabic) ? [] : [{ key, english, arabic }]
    })
    const used = [
      ...new Set(
        [...Object.values(EN), ...Object.values(AR)].flatMap(
          (value) => value.match(INTERPOLATION) ?? [],
        ),
      ),
    ].sort()

    expect(mismatches).toEqual([])
    expect(used).toEqual(EXPECTED_PLACEHOLDERS)
  })

  it('has the locale-specific i18next plural leaves for awaiting rows', () => {
    expect(
      Object.fromEntries(Object.keys(EN_ROW_FORMS).map((path) => [path, EN[path]])),
    ).toEqual(EN_ROW_FORMS)
    expect(
      Object.fromEntries(Object.keys(AR_ROW_FORMS).map((path) => [path, AR[path]])),
    ).toEqual(AR_ROW_FORMS)
  })

  it('has no Latin-script sentence leak in the Arabic feature copy', () => {
    const allowedTokens = /\b(?:XLSX|PDF|A4|IVR|HTML|Excel|Word|Outlook)\b/g
    const leaks = Object.entries(AR).flatMap(([path, value]) => {
      if (path === 'inmateStats.document.titleEn') return []
      const prose = value.replace(INTERPOLATION, '').replace(allowedTokens, '')
      return /[A-Za-z]/.test(prose) ? [{ path, value }] : []
    })
    expect(leaks).toEqual([])
  })

  it('keeps the settled close and pending-completion vocabulary', () => {
    const retired = Object.entries(AR).filter(([, value]) =>
      ['قفل الشهر', 'فتح القفل'].some((phrase) => value.includes(phrase)),
    )
    const blockedPhraseLocations = Object.entries(AR)
      .filter(([, value]) => value.includes('مطلوب إكمالها'))
      .map(([path]) => path)

    expect(retired).toEqual([])
    expect(blockedPhraseLocations).toEqual(['inmateStats.awaiting.blocked'])
    expect(AR['inmateStats.populations.pending']).toBe('قيد الإكمال')
  })

  it('resolves representative keys and interpolation through configured i18next resources', async () => {
    await i18n.changeLanguage('en')
    try {
      expect(i18n.t('application.approvedViolation.monthlyStatistics')).toBe('Monthly statistics')
      expect(i18n.t('dashboard.widgetLabels.violation_months')).toBe('Months awaiting close')
      expect(i18n.t('inmateStats.inspector.createdBy', { name: 'Ali', date: '2026-09-10' })).toBe(
        'Added by Ali on 2026-09-10',
      )
      expect(
        i18n.t('inmateStats.export.options.willReachLine', {
          rows: 8,
          derived: 6,
          manual: 2,
          tables: 3,
        }),
      ).toBe('8 entries · 6 derived · 2 manual · 3 tables')
      expect(i18n.t('inmateStats.export.referenceCell', { ref: 'IVR/2026-09' })).toBe(
        'See Record IVR/2026-09',
      )
      expect(i18n.t('inmateStats.close.otherOpenMonths', { months: '2026-07, 2026-08' })).toBe(
        'Other months are still open: 2026-07, 2026-08',
      )
      expect(i18n.t('inmateStats.awaiting.more', { count: 4 })).toBe(
        'More months awaiting close: 4',
      )

      await i18n.changeLanguage('ar')
      expect(i18n.t('application.approvedViolation.openRegister')).toBe('فتح السجل الشهري')
      expect(i18n.t('dashboard.widgetLabels.violation_months')).toBe('أشهر بانتظار الإغلاق')
      expect(i18n.t('inmateStats.inspector.createdBy', { name: 'علي', date: '2026-09-10' })).toBe(
        'أضافه علي في 2026-09-10',
      )
      expect(
        i18n.t('inmateStats.export.options.willReachLine', {
          rows: 8,
          derived: 6,
          manual: 2,
          tables: 3,
        }),
      ).toBe('8 سطر · 6 مستخرج · 2 يدوي · 3 جدول')
      expect(i18n.t('inmateStats.export.referenceCell', { ref: 'IVR/2026-09' })).toBe(
        'راجع التقرير IVR/2026-09',
      )
      expect(i18n.t('inmateStats.close.otherOpenMonths', { months: '2026-07، 2026-08' })).toBe(
        'أشهر أخرى ما زالت مفتوحة: 2026-07، 2026-08',
      )
      expect(i18n.t('inmateStats.awaiting.more', { count: 4 })).toBe(
        'أشهر أخرى بانتظار الإغلاق: 4',
      )
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('pluralizes awaiting rows through configured i18next resources', async () => {
    await i18n.changeLanguage('en')
    try {
      expect(i18n.t('inmateStats.awaiting.rows', { count: 1 })).toBe('1 entry')
      expect(i18n.t('inmateStats.awaiting.rows', { count: 3 })).toBe('3 entries')

      await i18n.changeLanguage('ar')
      expect(i18n.t('inmateStats.awaiting.rows', { count: 1 })).toBe('سطر واحد')
      expect(i18n.t('inmateStats.awaiting.rows', { count: 2 })).toBe('سطران')
      expect(i18n.t('inmateStats.awaiting.rows', { count: 3 })).toBe('3 أسطر')
      expect(i18n.t('inmateStats.awaiting.rows', { count: 11 })).toBe('11 سطرًا')
      expect(i18n.t('inmateStats.awaiting.rows', { count: 100 })).toBe('100 سطر')
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})
