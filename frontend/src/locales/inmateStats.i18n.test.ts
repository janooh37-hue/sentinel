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
  '{{displayed}}',
  '{{groups}}',
  '{{manual}}',
  '{{month}}',
  '{{name}}',
  '{{ref}}',
  '{{rows}}',
  '{{tables}}',
  '{{total}}',
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

function logicalKeys(strings: Strings): string[] {
  return Object.keys(strings).sort()
}

function placeholdersFor(strings: Strings, key: string): string[] {
  return [
    ...new Set(
      Object.entries(strings)
        .filter(([path]) => path === key)
        .flatMap(([, value]) => value.match(INTERPOLATION) ?? []),
    ),
  ].sort()
}

const EN = featureStrings(en as unknown as Rec)
const AR = featureStrings(ar as unknown as Rec)
const EN_KEYS = logicalKeys(EN)
const AR_KEYS = logicalKeys(AR)

const RETIRED_KEYS = [
  'inmateStats.actions.close',
  'inmateStats.actions.forceClose',
  'inmateStats.close',
  'inmateStats.document.titleEn',
  'inmateStats.export.options.language',
  'inmateStats.export.options.languageAr',
  'inmateStats.export.options.languageEn',
  'inmateStats.export.options.orientation',
  'inmateStats.export.options.landscape',
  'inmateStats.export.options.portrait',
] as const

describe('inmate statistics i18n parity', () => {
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

  it('does not retain retired direct-close or document-option copy', () => {
    const present = RETIRED_KEYS.flatMap((path) =>
      [
        ['en', get(en as unknown as Rec, path)],
        ['ar', get(ar as unknown as Rec, path)],
      ].flatMap(([locale, value]) => (value === undefined ? [] : [`${locale} ${path}`])),
    )
    expect(present).toEqual([])
  })

  it('has no Latin-script sentence leak in the Arabic feature copy', () => {
    const allowedTokens = /\b(?:XLSX|PDF|A4|IVR|HTML|Excel|Word|Outlook)\b/g
    const leaks = Object.entries(AR).flatMap(([path, value]) => {
      const prose = value.replace(INTERPOLATION, '').replace(allowedTokens, '')
      return /[A-Za-z]/.test(prose) ? [{ path, value }] : []
    })
    expect(leaks).toEqual([])
  })

  it('keeps the settled workflow and pending-completion vocabulary', () => {
    const retired = Object.entries(AR).filter(([, value]) =>
      ['قفل الشهر', 'فتح القفل'].some((phrase) => value.includes(phrase)),
    )
    expect(retired).toEqual([])
    expect(AR['inmateStats.populations.pending']).toBe('قيد الإكمال')
    expect(AR['inmateStats.workflow.errors.INMATE_REGISTER_INCOMPLETE_ENTRIES']).toContain('قيماً صحيحة لليوان')
  })

  it('resolves representative keys and interpolation through configured i18next resources', async () => {
    await i18n.changeLanguage('en')
    try {
      expect(i18n.t('application.approvedViolation.monthlyStatistics')).toBe('Monthly statistics')
      expect(i18n.t('dashboard.widgetLabels.violation_months')).toBe('Monthly report workflow')
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
      expect(
        i18n.t('inmateStats.document.extractCaption', {
          groups: 'Citizens',
          displayed: 8,
          total: 12,
        }),
      ).toBe('Extract: Citizens — 8 of 12 month rows')
      expect(i18n.t('nav.bell.notify.monthlyReview')).toBe(
        'A monthly inmate violations report needs your review',
      )

      await i18n.changeLanguage('ar')
      expect(i18n.t('application.approvedViolation.openRegister')).toBe('فتح السجل الشهري')
      expect(i18n.t('dashboard.widgetLabels.violation_months')).toBe('اعتماد التقارير الشهرية')
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
      expect(
        i18n.t('inmateStats.document.extractCaption', {
          groups: 'المواطنين',
          displayed: 8,
          total: 12,
        }),
      ).toBe('مقتطف: المواطنين — 8 من أصل 12 سطرًا للشهر')
      expect(i18n.t('nav.bell.notify.monthlyApproval')).toBe(
        'تقرير مخالفات النزلاء الشهري بانتظار اعتمادك',
      )
    } finally {
      await i18n.changeLanguage('en')
    }
  })

})
