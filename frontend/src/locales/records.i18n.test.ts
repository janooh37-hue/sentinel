/** Record page v2: the new key subtrees exist in EN and AR with identical
 * shape, non-empty values, and full CLDR plural sets where counted. */
import { describe, expect, it } from 'vitest'

import ar from './ar.json'
import en from './en.json'

type Rec = Record<string, unknown>

function node(o: Rec, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, k) => (cur as Rec | undefined)?.[k], o)
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

/** Leaf paths with plural suffixes folded (EN has 2 forms, AR has 6). */
function shape(value: unknown): string[] {
  return [...new Set(leaves(value).map((k) => k.replace(PLURAL_SUFFIX, '')))].sort()
}

function leaves(value: unknown, prefix = ''): string[] {
  if (value && typeof value === 'object') {
    return Object.entries(value as Rec).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
  }
  return [prefix]
}

const SUBTREES = [
  'books.record',
  'books.status',
  'books.reason',
  'books.paper',
  'books.pane',
  'books.list',
  'books.approval',
  'books.toast',
  'shortcuts.records',
]
const EXTRA_KEYS = [
  'common.done',
  'application.pdfNotGenerated',
  'application.pdfUnavailableNoDocx',
  'books.toast.voided',
  'books.approval.reroute',
  'books.approval.signing',
  'books.approval.returning',
  'books.approval.rejecting',
]
const COUNTED = [
  'books.paper.captionReturned',
  'books.paper.pages',
  'books.paper.marksFrom',
  'books.pane.papers',
  'books.list.selected',
  'books.list.deleteMany',
  'books.list.skippedMany',
  'books.list.deletedMany',
  'books.list.restoredMany',
]
const AR_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other']

describe('record page i18n', () => {
  it.each(SUBTREES)('%s has the same keys in EN and AR', (path) => {
    expect(shape(node(ar, path))).toEqual(shape(node(en, path)))
  })

  it.each(SUBTREES)('%s has no empty values', (path) => {
    for (const locale of [en, ar] as Rec[]) {
      for (const key of leaves(node(locale, path), path)) {
        const v = node(locale, key)
        expect(typeof v === 'string' && v.trim().length > 0, key).toBe(true)
      }
    }
  })

  it.each(EXTRA_KEYS)('%s is present and non-empty in both locales', (key) => {
    for (const locale of [en, ar] as Rec[]) {
      const v = node(locale, key)
      expect(typeof v === 'string' && v.trim().length > 0, key).toBe(true)
    }
  })

  it.each(COUNTED)('%s has EN one/other and all six AR plural forms', (key) => {
    for (const form of ['one', 'other']) expect(node(en, `${key}_${form}`), form).toBeTruthy()
    for (const form of AR_FORMS) expect(node(ar, `${key}_${form}`), form).toBeTruthy()
    expect(node(en, key)).toBeUndefined()
    expect(node(ar, key)).toBeUndefined()
  })

  it('keeps the same placeholders across EN and AR', () => {
    const vars = (s: string): string[] => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
    for (const path of SUBTREES) {
      for (const key of leaves(node(en, path), path)) {
        if (/_(zero|one|two|few|many|other)$/.test(key)) continue
        const e = node(en, key) as string
        const a = node(ar, key) as string
        expect(vars(a), key).toEqual(vars(e))
      }
    }
  })
})
