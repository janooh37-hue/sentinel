import { describe, expect, it } from 'vitest'

import ar from '@/locales/ar.json'
import en from '@/locales/en.json'

type Tree = { [key: string]: string | Tree }

const EN_PLURAL = ['_one', '_other'] as const
const AR_PLURAL = ['_zero', '_one', '_two', '_few', '_many', '_other'] as const
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out.set(path, value)
    else for (const [k, v] of leaves(value, path)) out.set(k, v)
  }
  return out
}

/** Leaf keys with plural suffixes folded to their base key. */
function baseKeys(map: Map<string, string>): Set<string> {
  return new Set([...map.keys()].map((key) => key.replace(PLURAL_SUFFIX, '')))
}

function variables(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!).sort()
}

const enAssets = leaves((en as unknown as Tree).assets as Tree, 'assets')
const arAssets = leaves((ar as unknown as Tree).assets as Tree, 'assets')

describe('assets locale parity', () => {
  it('names the Assets destination in both languages', () => {
    expect(en.nav.assets).toBe('Assets')
    expect(ar.nav.assets).toBe('الأصول')
  })

  it('covers the room frontend namespaces', () => {
    for (const prefix of ['assets.store.dashboard.', 'assets.store.handovers.', 'assets.store.movements.', 'assets.store.items.picture']) {
      expect([...enAssets.keys()].some(key => key.startsWith(prefix)), prefix).toBe(true)
      expect([...arAssets.keys()].some(key => key.startsWith(prefix)), prefix).toBe(true)
    }
    expect(enAssets.has('assets.store.tabs.movements')).toBe(true)
    expect(arAssets.has('assets.store.tabs.movements')).toBe(true)
  })

  it('gives every English key an Arabic peer and no Arabic-only keys', () => {
    expect([...baseKeys(arAssets)].sort()).toEqual([...baseKeys(enAssets)].sort())
  })

  it('carries the full plural set in each language', () => {
    const plurals = [...baseKeys(enAssets)].filter((key) => enAssets.has(`${key}_other`))
    for (const key of plurals) {
      for (const suffix of EN_PLURAL) expect(enAssets.has(`${key}${suffix}`), `${key}${suffix}`).toBe(true)
      for (const suffix of AR_PLURAL) expect(arAssets.has(`${key}${suffix}`), `${key}${suffix}`).toBe(true)
    }
  })

  it('uses natural Arabic punctuation for every expiring-soon window plural', () => {
    for (const suffix of AR_PLURAL) {
      const text = arAssets.get(`assets.store.dashboard.soonWindow${suffix}`)
      expect(text).toContain(': خلال')
      expect(text).not.toContain('=')
    }
  })

  it('uses the same interpolation variables and no empty strings', () => {
    for (const [key, enText] of enAssets) {
      expect(enText.trim(), key).not.toBe('')
      const base = key.replace(PLURAL_SUFFIX, '')
      const arPeers = [...arAssets].filter(([k]) => k === key || k.replace(PLURAL_SUFFIX, '') === base)
      for (const [arKey, arText] of arPeers) {
        expect(arText.trim(), arKey).not.toBe('')
        // `count` may be implicit in an Arabic singular/dual form.
        const arVars = variables(arText).filter((v) => v !== 'count')
        const enVars = variables(enText).filter((v) => v !== 'count')
        expect(arVars, arKey).toEqual(enVars)
      }
    }
  })
})
