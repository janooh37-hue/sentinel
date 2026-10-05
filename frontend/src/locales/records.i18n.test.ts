/** Record page v2: the new key subtrees exist in EN and AR with identical
 * shape, non-empty values, and full CLDR plural sets for every `{{count}}` key
 * (derived by scanning EN, not hand-listed). Removed keys stay removed. */
import { describe, expect, it } from 'vitest'

import ar from './ar.json'
import en from './en.json'

type Rec = Record<string, unknown>

function node(o: Rec, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, k) => (cur as Rec | undefined)?.[k], o)
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/
const placeholders = (s: string): string[] => [...new Set([...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].sort()

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
  'books.word',
  'books.annotations',
  'books.stateOverride',
  'books.preview',
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
/** Keys whose value this PR relabelled in place (the text changed, the key did not). */
const RELABELLED_KEYS = [
  'books.approval.return',
  'books.approval.returnShort',
  'books.annotations.mark',
  'books.stateOverride.trigger',
  'books.preview.discard',
  'books.word.discard',
  'books.word.discardConfirmLabel',
]
/** Cut over and gone: nothing may reintroduce them. */
const REMOVED_KEYS = [
  'books.record.viewOriginal',
  'books.record.prevAwaiting',
  'books.record.nextAwaiting',
  'books.toast.deleted',
  'books.bulk.deleted',
  'books.bulk.deleteError',
  'books.empty',
  'books.bulk.deleteTitle',
  'books.bulk.deleteBody',
  'books.columns.subject',
  'books.versions.current',
  'books.versions.reviseHint',
  'books.versions.signedPdf',
  'books.executedCopy',
  'books.pane.generated',
  'books.pane.signedCopy',
  'books.pane.scan',
  'books.pane.imported',
]
const AR_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other']

/** Base keys of every plural-suffixed or `{{count}}` leaf under the tested subtrees, in either locale. */
function countedKeys(): string[] {
  const found = new Set<string>()
  for (const locale of [en, ar] as Rec[]) {
    for (const path of SUBTREES) {
      for (const key of leaves(node(locale, path), path)) {
        const v = node(locale, key)
        if (typeof v === 'string' && v.includes('{{count}}')) found.add(key.replace(PLURAL_SUFFIX, ''))
      }
    }
  }
  return [...found].sort()
}
const COUNTED = countedKeys()

describe('record page i18n', () => {
  it('finds the counted keys by scanning (a broken scan must not pass vacuously)', () => {
    expect(COUNTED).toEqual(
      expect.arrayContaining(['books.paper.pages', 'books.pane.papers', 'books.list.selected', 'books.list.skippedMany']),
    )
  })

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

  it.each([...EXTRA_KEYS, ...RELABELLED_KEYS])('%s is present and non-empty in both locales', (key) => {
    for (const locale of [en, ar] as Rec[]) {
      const v = node(locale, key)
      expect(typeof v === 'string' && v.trim().length > 0, key).toBe(true)
    }
  })

  it.each(COUNTED)('%s has EN one/other and all six AR plural forms, and no bare key', (key) => {
    for (const form of ['one', 'other']) expect(node(en, `${key}_${form}`), `en ${form}`).toBeTruthy()
    for (const form of AR_FORMS) expect(node(ar, `${key}_${form}`), `ar ${form}`).toBeTruthy()
    expect(node(en, key)).toBeUndefined()
    expect(node(ar, key)).toBeUndefined()
  })

  it('keeps the same placeholders across EN and AR, plural forms included', () => {
    for (const path of SUBTREES) {
      for (const key of leaves(node(en, path), path)) {
        if (PLURAL_SUFFIX.test(key)) continue
        expect(placeholders(node(ar, key) as string), key).toEqual(placeholders(node(en, key) as string))
      }
    }
    for (const key of COUNTED) {
      const enOther = placeholders(node(en, `${key}_other`) as string)
      // `_other` carries the full set; a form may drop `{{count}}` ("no records") but never add a variable.
      expect(placeholders(node(ar, `${key}_other`) as string), `${key}_other`).toEqual(enOther)
      for (const form of AR_FORMS) {
        const used = placeholders(node(ar, `${key}_${form}`) as string)
        expect(used.filter((v) => !enOther.includes(v)), `${key}_${form}`).toEqual([])
      }
      for (const form of ['one', 'other']) {
        const used = placeholders(node(en, `${key}_${form}`) as string)
        expect(used.filter((v) => !enOther.includes(v)), `en ${key}_${form}`).toEqual([])
      }
    }
  })

  it.each(REMOVED_KEYS)('%s stays removed from both locales', (key) => {
    expect(node(en, key), 'en').toBeUndefined()
    expect(node(ar, key), 'ar').toBeUndefined()
  })
})
