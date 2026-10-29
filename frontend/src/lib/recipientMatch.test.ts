import { describe, expect, it } from 'vitest'
import type { AddressBookContactRead } from '@/lib/api'
import { normalize, normalizeSearchText, rankContacts } from './recipientMatch'

function contact(id: number, display_name: string, address: string): AddressBookContactRead {
  return { id, display_name, address, created_at: '2026-10-29T00:00:00Z' }
}

describe('normalizeSearchText', () => {
  it('normalizes compatibility forms, Latin case and Unicode whitespace', () => {
    expect(normalizeSearchText(' \tＦＩＮＡＮＣＥ\u00a0\nEditor  ')).toBe('finance editor')
    expect(normalizeSearchText('ﻻ')).toBe('لا')
    expect(normalizeSearchText('e\u0301')).toBe('é')
  })

  it('strips Arabic diacritics, Quranic combining marks and tatweel', () => {
    expect(normalizeSearchText('مُـحَمَّد')).toBe('محمد')
    expect(normalizeSearchText('م\u0610ح\u0651م\u0670د\u06e7')).toBe('محمد')
    expect(normalizeSearchText('  \u0640\u064e  ')).toBe('')
  })

  it.each(['آ', 'أ', 'إ', 'ٱ', 'ٲ', 'ٳ', 'ٵ'])('folds alef variant %s', (alef) => {
    expect(normalizeSearchText(alef)).toBe('ا')
  })

  it('folds alef maqsura without transliterating names or removing other letters', () => {
    expect(normalizeSearchText('مُصْطَفَى')).toBe('مصطفي')
    expect(normalizeSearchText('علي')).not.toBe(normalizeSearchText('Ali'))
    expect(normalizeSearchText('ؤ ئ ء')).toBe('ؤ ئ ء')
  })

  it('converts Arabic and Persian digits without changing numeric identity', () => {
    expect(normalizeSearchText('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789')
    expect(normalizeSearchText('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789')
    expect(normalizeSearchText('G-٠۰١۲')).toBe('g-0012')
    expect(normalizeSearchText('٠٠١٢')).not.toBe(normalizeSearchText('١٢'))
    expect(normalizeSearchText('١٢٣')).not.toBe(normalizeSearchText('١٢٤'))
  })

  it('retains ta marbuta on the strict pass and folds it only when relaxed', () => {
    expect(normalizeSearchText('فَاطِمَة')).toBe('فاطمة')
    expect(normalizeSearchText('فَاطِمَة', false)).not.toBe(normalizeSearchText('فاطمه'))
    expect(normalizeSearchText('فَاطِمَة', true)).toBe(normalizeSearchText('فاطمه', true))
    expect(normalizeSearchText('ةه', true)).toBe('هه')
  })

  it.each([false, true])('is idempotent with relaxed=%s', (relaxed) => {
    const normalized = normalizeSearchText('  إِدارة\tمُصْطَفَى ـ ۱۲٣  ', relaxed)
    expect(normalizeSearchText(normalized, relaxed)).toBe(normalized)
  })
})

describe('recipient normalization regressions', () => {
  it('keeps existing lowercase, NFKD and Arabic combining-mark behavior', () => {
    expect(normalize('MUHAMMAD مُحَمَّد')).toBe('muhammad محمد')
    expect(normalize('É')).toBe('e\u0301')
    // Preserve the legacy range's digit stripping rather than changing recipients.
    expect(normalize('  فاطمة  ى ـ ١۲  ')).toBe('  فاطمة  ى ـ ۲  ')
  })

  it('does not adopt search-only whitespace, tatweel, spelling or digit folding', () => {
    const contacts = [contact(1, 'فاطمة علي', 'person@example.test')]
    expect(rankContacts(contacts, 'فاطمه')).toEqual([])
    expect(rankContacts(contacts, 'فاطـمة')).toEqual([])
    expect(rankContacts(contacts, 'فاطمة  علي')).toEqual([])
    expect(rankContacts([contact(2, 'Person ١٢', 'numeric@example.test')], '12')).toEqual([])
    expect(rankContacts([contact(3, 'مصطفى', 'name@example.test')], 'مصطفي')).toEqual([])
  })
})

describe('rankContacts', () => {
  it('ranks name or address prefixes before substrings, retaining order within each tier', () => {
    const substring = contact(1, 'Team Alice', 'team@example.test')
    const addressPrefix = contact(2, 'Finance', 'alice@example.test')
    const namePrefix = contact(3, 'Alice Adams', 'adams@example.test')
    const addressSubstring = contact(4, 'Operations', 'team.alice@example.test')
    const unmatched = contact(5, 'Other', 'other@example.test')
    const contacts = [substring, addressPrefix, namePrefix, addressSubstring, unmatched]

    const result = rankContacts(contacts, ' ALICE ')

    expect(result).toEqual([addressPrefix, namePrefix, substring, addressSubstring])
    expect(result[0]).toBe(addressPrefix)
    expect(contacts).toEqual([substring, addressPrefix, namePrefix, addressSubstring, unmatched])
  })

  it('still matches names with Arabic diacritics and case-insensitive addresses', () => {
    const muhammad = contact(1, 'مُحَمَّد', 'Muhammad@Example.test')
    expect(rankContacts([muhammad], 'محمد')).toEqual([muhammad])
    expect(rankContacts([muhammad], 'MUHAMMAD@EXAMPLE')).toEqual([muhammad])
  })

  it('keeps repeated names as distinct contacts with their original identities', () => {
    const first = contact(1, 'محمد علي', 'first@example.test')
    const second = contact(2, 'محمد علي', 'second@example.test')
    expect(rankContacts([first, second], 'محمد')).toEqual([first, second])
  })

  it.each(['', ' ', '\t\n'])('returns no suggestions for an empty query %j', (query) => {
    expect(rankContacts([contact(1, 'Alice', 'alice@example.test')], query)).toEqual([])
  })
})
