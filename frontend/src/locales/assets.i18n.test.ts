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

  it('provides every delivery-note scan label in English and Arabic', () => {
    const required = [
      'title', 'description', 'entry', 'chooseFile', 'fileHint', 'reading',
      'cancelReading', 'confirmTitle', 'confirmDescription', 'needsLook',
      'unmatched', 'lowConfidence', 'onNote', 'received', 'line', 'skipLine',
      'unknownQuantity', 'reason', 'reasonRequired', 'skip', 'noLines',
      'unavailable', 'nothingRead', 'manual', 'back', 'cropAlt',
      'cropUnavailable', 'retryUpload', 'finishWithoutFile', 'uploadFailed',
      'quantityRequired', 'dateRequired', 'savedWithoutFile', 'scanTimeout',
      'tooManyPages',
    ]
    const enKeys = baseKeys(enAssets)
    const arKeys = baseKeys(arAssets)
    for (const key of required) {
      const path = `assets.store.scan.${key}`
      expect(enKeys.has(path), path).toBe(true)
      expect(arKeys.has(path), path).toBe(true)
    }
    for (const suffix of EN_PLURAL) {
      expect(variables(en.assets.store.scan[`needsLook${suffix}`])).toContain('count')
      expect(en.assets.store.scan[`needsLook${suffix}`]).toContain('<count>{{count}}</count>')
    }
    for (const suffix of AR_PLURAL) {
      expect(ar.assets.store.scan[`needsLook${suffix}`].trim()).not.toBe('')
      const text = ar.assets.store.scan[`needsLook${suffix}`]
      if (variables(text).includes('count')) expect(text).toContain('<count>{{count}}</count>')
    }
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

describe('armory locale contract', () => {
  const enArmory = [...enAssets].filter(([key]) => key.startsWith('assets.armory.'))
  const arArmory = [...arAssets].filter(([key]) => key.startsWith('assets.armory.'))

  it('keeps the approved Armory names and the shared enum vocabularies in both languages', () => {
    const pairs: [string, string, string][] = [
      ['assets.armory.armory', 'Armory', 'خزنة السلاح'],
      ['assets.armory.widgetTitle', 'Armory exceptions', 'تنبيهات خزنة السلاح'],
      ['assets.armory.signout', 'Issue', 'صرف'],
      ['assets.armory.signin', 'Return', 'إرجاع'],
      ['assets.armory.handover', 'Hand over custody', 'تسليم عهدة'],
      ['assets.armory.shiftCheck', 'Shift check', 'فحص الوردية'],
      ['assets.armory.needsDecision', 'Needs a decision', 'يحتاج قرارًا'],
      ['assets.armory.clearSearch', 'Clear search filter', 'إلغاء تصفية البحث'],
    ]
    for (const [key, enText, arText] of pairs) {
      expect(enAssets.get(key), key).toBe(enText)
      expect(arAssets.get(key), key).toBe(arText)
    }
    const enums: Record<string, readonly string[]> = {
      serialState: ['in_safe', 'signed_out', 'in_custody', 'in_repair', 'missing', 'lost', 'written_off'],
      licenceStatus: ['missing', 'expired', 'expiring', 'valid'],
      postingKind: ['opening', 'receipt', 'serial_registration', 'shift_issue', 'custody', 'return', 'shift_check', 'monthly_count', 'serial_state', 'decision'],
      discrepancyKind: ['rounds_shortfall', 'missing_serial', 'unexpected_serial', 'monthly_quantity'],
      discrepancyStatus: ['open', 'resolved', 'voided'],
      decisionOutcome: ['found', 'used_in_training', 'lost', 'recording_error'],
      shortfallReason: ['training', 'incident', 'lost', 'other'],
      serialAction: ['send_repair', 'return_repair', 'mark_lost', 'write_off', 'transfer'],
      assignmentState: ['active', 'ended', 'voided'],
      categoryName: ['firearms', 'ammo', 'accessories', 'nonlethal', 'restraints', 'riot', 'comms'],
      kitName: ['rifle', 'pistol', 'equipment'],
    }
    for (const [group, values] of Object.entries(enums)) {
      for (const value of values) {
        const key = `assets.armory.${group}.${value}`
        expect(enAssets.get(key)?.trim(), key).toBeTruthy()
        expect(arAssets.get(key)?.trim(), key).toBeTruthy()
      }
    }
  })

  it('labels the Armory permission domain and dashboard source with the Armory name', () => {
    expect(en.access.permissions.domains.armory).toBe('Armory')
    expect(ar.access.permissions.domains.armory).toBe('خزنة السلاح')
    expect(en.dashboard.customize.sources.armory).toBe('Armory')
    expect(ar.dashboard.customize.sources.armory).toBe('خزنة السلاح')
  })

  it('states that a licence acknowledgement does not authorize release', () => {
    expect(enAssets.get('assets.armory.licenceAcknowledge')).toBe('I acknowledge the licence warning on this record.')
    expect(arAssets.get('assets.armory.licenceAcknowledge')).toBe('أقرّ بتنبيه الرخصة الوارد في هذا السجل.')
    expect(enAssets.get('assets.armory.releaseNotAuthorized')).toBe('Recording does not authorize release.')
    expect(arAssets.get('assets.armory.releaseNotAuthorized')).toBe('تسجيل المعاملة لا يجيز تسليم المعدات.')
  })

  it('ships no mockup preview copy, old-style placeholders or dashes', () => {
    for (const [key, text] of [...enArmory, ...arArmory]) {
      expect(text, key).not.toMatch(/in this preview|هذه المعاينة|approval mockup|نموذج للاعتماد/i)
      expect(text, key).not.toMatch(/(^|[^{])\{[a-z#]/i)
      expect(text, key).not.toMatch(/[\u2013\u2014]/)
    }
  })
})
