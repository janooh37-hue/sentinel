import { describe, expect, it } from 'vitest'

import { scriptLang } from './paperText'

describe('scriptLang', () => {
  it.each([
    ['موقع الوثبة', 'ar'],
    ['Operations، Security', 'en'],
    ['العمليات، ١٢٣', 'ar'],
    ['Main Gate 7', 'en'],
    ['123، 456', undefined],
    ['١٢٣٤', undefined],
    ['G3190/1/12', 'en'],
    ['Leave - إجازة', undefined],
    ['', undefined],
    [null, undefined],
  ])('%j is %s', (text, expected) => {
    expect(scriptLang(text)).toBe(expected)
  })
})
