import { afterEach, describe, expect, it } from 'vitest'

import i18n from '@/lib/i18n'

import { statusDetailText } from './statusDetail'

const FSI = '⁨'
const PDI = '⁩'
const iso = (s: string): string => `${FSI}${s}${PDI}`

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('statusDetailText', () => {
  it.each([
    ['en', 'Active', 'Active'],
    ['en', 'Loaned', 'Loaned'],
    ['ar', 'Active', 'نشط'],
    ['ar', 'Loaned', 'ملحق'],
  ] as const)('%s: %s is just the label even with an end date and stale transfer fields', async (language, status, label) => {
    await i18n.changeLanguage(language)
    expect(statusDetailText(i18n.t, { status, end_date: null })).toBe(label)
    expect(statusDetailText(i18n.t, {
      status,
      end_date: '2026-08-15',
      transfer_site: 'Port A',
      transfer_return_date: '2026-11-15',
    })).toBe(label)
  })

  it('EN: resigned shows the date', async () => {
    await i18n.changeLanguage('en')
    expect(statusDetailText(i18n.t, { status: 'Resigned', end_date: '2026-08-15' })).toBe(
      `Resigned · ${iso('15/08/2026')}`,
    )
  })

  it('EN: transferred shows site and date, plus expected return', async () => {
    await i18n.changeLanguage('en')
    const base = { status: 'Transferred', end_date: '2026-08-15', transfer_site: 'Port A' } as const
    expect(statusDetailText(i18n.t, base)).toBe(`Transferred · ${iso('Port A')} · ${iso('15/08/2026')}`)
    expect(statusDetailText(i18n.t, { ...base, transfer_return_date: '2026-11-15' })).toBe(
      `Transferred · ${iso('Port A')} · ${iso('15/08/2026')} → ${iso('15/11/2026')}`,
    )
  })

  it('AR: translated status, no English leak, RTL arrow', async () => {
    await i18n.changeLanguage('ar')
    const text = statusDetailText(i18n.t, {
      status: 'Transferred',
      end_date: '2026-08-15',
      transfer_site: 'ميناء',
      transfer_return_date: '2026-11-15',
    })
    expect(text).toBe(`منقول · ${iso('ميناء')} · ${iso('15/08/2026')} ← ${iso('15/11/2026')}`)
    expect(statusDetailText(i18n.t, { status: 'Resigned', end_date: '2026-08-15' })).toBe(
      `مستقيل · ${iso('15/08/2026')}`,
    )
  })
})
