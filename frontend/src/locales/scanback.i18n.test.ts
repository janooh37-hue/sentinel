import { describe, it, expect } from 'vitest'
import en from '@/locales/en.json'
import ar from '@/locales/ar.json'

type Rec = Record<string, unknown>
const get = (o: Rec, path: string): string =>
  path.split('.').reduce<unknown>((c, k) => (c as Rec)?.[k], o) as string

const KEYS = [
  'nav.scanBack',
  'nav.bell.scanBackTitle',
  'scanBack.title', 'scanBack.blurb', 'scanBack.empty',
  'scanBack.scope.mine', 'scanBack.scope.all',
  'scanBack.sort.oldest', 'scanBack.sort.newest',
  'scanBack.group.overMonth', 'scanBack.group.weeks', 'scanBack.group.recent',
  'scanBack.drop', 'scanBack.filed', 'scanBack.uploadError',
  'scanBack.gate.blurb', 'scanBack.gate.upload', 'scanBack.gate.later', 'scanBack.gate.close',
  'scanBack.dock.header', 'scanBack.dock.expand', 'scanBack.dock.collapse',
]

// Counted strings: EN needs _one/_other, AR needs all six CLDR forms.
const COUNTED = ['nav.bell.scanBack', 'scanBack.age', 'scanBack.gate.title',
                 'scanBack.viewAll', 'scanBack.dock.pill']
const AR_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other']

describe('scan-back i18n parity', () => {
  for (const k of KEYS) {
    it(`${k} exists in both`, () => {
      expect(get(en as unknown as Rec, k)).toBeTruthy()
      expect(get(ar as unknown as Rec, k)).toBeTruthy()
    })
    it(`${k} ar differs from en (no English leak)`, () => {
      expect(get(ar as unknown as Rec, k)).not.toBe(get(en as unknown as Rec, k))
    })
  }

  for (const k of COUNTED) {
    it(`${k} has en _one/_other`, () => {
      expect(get(en as unknown as Rec, `${k}_one`)).toBeTruthy()
      expect(get(en as unknown as Rec, `${k}_other`)).toBeTruthy()
    })
    it(`${k} has all six ar plural forms`, () => {
      for (const f of AR_FORMS) {
        expect(get(ar as unknown as Rec, `${k}_${f}`)).toBeTruthy()
      }
    })
    it(`${k} ar interpolates {{count}}`, () => {
      expect(get(ar as unknown as Rec, `${k}_other`)).toContain('{{count}}')
    })
  }
})
