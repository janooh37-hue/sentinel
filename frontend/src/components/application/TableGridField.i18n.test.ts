import { describe, it, expect } from 'vitest'
import en from '@/locales/en.json'
import ar from '@/locales/ar.json'

type Rec = Record<string, unknown>
function get(o: Rec, path: string): string {
  return path.split('.').reduce<unknown>((c, k) => (c as Rec)?.[k], o) as string
}
const KEYS = [
  'books.word.baseTemplate.text','books.word.baseTemplate.table',
  'books.word.baseTemplate.group','books.word.customTemplate.group',
  'books.word.tableGrid.loading','books.word.tableGrid.error',
  'books.word.tableGrid.empty','books.word.tableGrid.columnLabel',
  'books.word.deleteTemplate','books.word.deleteTemplateConfirm','books.word.deleted',
]
describe('M4d i18n parity', () => {
  for (const k of KEYS) {
    it(`${k} in both`, () => {
      expect(get(en as unknown as Rec, k)).toBeTruthy()
      expect(get(ar as unknown as Rec, k)).toBeTruthy()
    })
    it(`${k} ar != en unless token-only`, () => {
      const e = get(en as unknown as Rec, k); const a = get(ar as unknown as Rec, k)
      if (!e.includes('{{')) expect(a).not.toBe(e)
    })
  }
})
