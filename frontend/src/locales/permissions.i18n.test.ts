/** Cross-stack guard: every capability in the PYTHON catalog must have an EN+AR
 * label, description, and domain key. Parses core/permissions.py so a new cap
 * without translations fails CI here, not in front of an Arabic-speaking admin. */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import ar from './ar.json'
import en from './en.json'

type Rec = Record<string, unknown>

// Dotted capability ids (`books.approve`) are single JSON keys inside a
// dot-separated path, so the walk must greedily try longer joined keys —
// mirroring i18next's deepFind, which is what resolves these paths at runtime.
function get(o: Rec, path: string): unknown {
  const tokens = path.split('.')
  let current: unknown = o
  let index = 0
  while (index < tokens.length) {
    if (!current || typeof current !== 'object') return undefined
    const record = current as Rec
    let matchedAt = -1
    let value: unknown
    let candidate = ''
    for (let j = index; j < tokens.length; ++j) {
      candidate = candidate ? `${candidate}.${tokens[j]}` : tokens[j]
      const probe = record[candidate]
      if (probe === undefined) continue
      value = probe
      matchedAt = j
      const primitive = probe === null || typeof probe !== 'object'
      if (!(primitive && j < tokens.length - 1)) break
    }
    if (matchedAt < 0) return undefined
    index = matchedAt + 1
    current = value
  }
  return current
}

// Not `new URL(literal, import.meta.url)` on purpose: Vite rewrites that exact
// shape into an asset import, which breaks the read at runtime.
const LOCALES_DIR = dirname(fileURLToPath(import.meta.url))
const CATALOG_SRC = readFileSync(
  resolve(LOCALES_DIR, '../../../backend/app/core/permissions.py'),
  'utf-8',
)
// One or more dot-separated [a-z_] segments: the catalog carries three-part
// ids too (`books.override_state` aside — think `employees.vault.manage`,
// `workforce.attendance.review`), which a single-dot pattern silently drops.
const IDS = [...CATALOG_SRC.matchAll(/Capability\(\s*"([a-z_]+(?:\.[a-z_]+)+)"/g)].map((m) => m[1])

describe('permission catalog i18n completeness', () => {
  it('found the catalog', () => {
    expect(IDS.length).toBeGreaterThanOrEqual(50)
  })

  // vitest's expect takes no jest-style message argument, so each check pushes
  // its context (locale + dotted path) into `missing`; one failing id then
  // reports every gap for both locales in a single diff.
  it.each(IDS)('%s has en + ar label, description, and its domain is named', (id) => {
    const missing: string[] = []
    for (const [locale, tree] of [['en', en], ['ar', ar]] as const) {
      if (!get(tree as unknown as Rec, `access.permissions.caps.${id}`)) {
        missing.push(`${locale} label ${id}`)
      }
      if (!get(tree as unknown as Rec, `perms.caps.${id}.desc`)) {
        missing.push(`${locale} desc ${id}`)
      }
    }
    const domain = id.split('.')[0]
    if (!get(en as unknown as Rec, `access.permissions.domains.${domain}`)) {
      missing.push(`en domain ${domain}`)
    }
    if (!get(ar as unknown as Rec, `access.permissions.domains.${domain}`)) {
      missing.push(`ar domain ${domain}`)
    }
    expect(missing).toEqual([])
  })
})

describe('Mirror editor bilingual copy', () => {
  it('ships every new EN/AR label and complete count plurals', () => {
    const missing: string[] = []
    const sharedKeys = [
      'access.permissions.mirror.pickUser',
      'access.permissions.mirror.nothingVisible',
      'access.permissions.mirror.userNotFound',
      'access.permissions.mirror.blueprintLabel',
      'access.permissions.mirror.viewPrereqWarning',
      'access.permissions.mirror.consequenceRecords',
      'access.permissions.mirror.serviceOther',
      'access.permissions.mirror.people',
      'access.permissions.mirror.searchPeople',
      'access.permissions.mirror.openPreview',
      'access.permissions.mirror.closePreview',
      'access.permissions.mirror.svcFull',
      'access.permissions.mirror.svcRecordsOnly',
      'access.permissions.mirror.svcHidden',
      'access.permissions.mirror.svcLegend',
      'access.permissions.mirror.svcFullCaption',
      'access.permissions.mirror.svcRecordsOnlyCaption',
      'access.permissions.mirror.svcHiddenCaption',
      'requireCap.notRequestable',
      'access.permissions.caps.books.service.other',
    ]
    for (const [locale, tree] of [['en', en], ['ar', ar]] as const) {
      for (const key of sharedKeys) {
        if (!get(tree as unknown as Rec, key)) missing.push(`${locale} ${key}`)
      }
    }
    for (const suffix of ['one', 'other']) {
      if (!get(en as unknown as Rec, `access.permissions.mirror.availableCount_${suffix}`)) {
        missing.push(`en availableCount_${suffix}`)
      }
      if (!get(en as unknown as Rec, `access.permissions.mirror.hiddenLabel_${suffix}`)) {
        missing.push(`en hiddenLabel_${suffix}`)
      }
      if (!get(en as unknown as Rec, `access.permissions.mirror.peopleCount_${suffix}`)) {
        missing.push(`en peopleCount_${suffix}`)
      }
    }
    for (const suffix of ['zero', 'one', 'two', 'few', 'many', 'other']) {
      if (!get(ar as unknown as Rec, `access.permissions.mirror.availableCount_${suffix}`)) {
        missing.push(`ar availableCount_${suffix}`)
      }
      if (!get(ar as unknown as Rec, `access.permissions.mirror.hiddenLabel_${suffix}`)) {
        missing.push(`ar hiddenLabel_${suffix}`)
      }
      if (!get(ar as unknown as Rec, `access.permissions.mirror.peopleCount_${suffix}`)) {
        missing.push(`ar peopleCount_${suffix}`)
      }
    }
    expect(missing).toEqual([])
  })

  // The Services tile is a card (بطاقة); أيقونة is the emoji inside it, so the
  // legend and the Hidden caption must not promise the wrong thing.
  it('calls the Services tile a card in Arabic, not an icon', () => {
    const legend = String(get(ar as unknown as Rec, 'access.permissions.mirror.svcLegend'))
    const hiddenCaption = String(
      get(ar as unknown as Rec, 'access.permissions.mirror.svcHiddenCaption'),
    )

    expect(legend).toContain('بطاقة')
    expect(legend).not.toContain('أيقونة')
    expect(hiddenCaption).toContain('بطاقة')
    expect(hiddenCaption).not.toContain('أيقونة')
  })

  it('describes the Records prerequisite and assignee exception truthfully in both languages', () => {
    const enWarning = String(
      get(en as unknown as Rec, 'access.permissions.mirror.viewPrereqWarning'),
    )
    const arWarning = String(
      get(ar as unknown as Rec, 'access.permissions.mirror.viewPrereqWarning'),
    )
    const enConsequence = String(
      get(en as unknown as Rec, 'access.permissions.mirror.consequenceRecords'),
    )
    const arConsequence = String(
      get(ar as unknown as Rec, 'access.permissions.mirror.consequenceRecords'),
    )

    expect(enWarning).toContain('cannot create or browse records')
    expect(enWarning).toContain('awaiting their approval')
    expect(arWarning).toContain('صفحة المستندات مخفية')
    expect(arWarning).toContain('المنتظرة اعتماده')
    expect(enConsequence).toContain('Records hidden')
    expect(enConsequence).toContain('creation blocked')
    expect(arConsequence).toContain('صفحة المستندات مخفية')
    expect(arConsequence).toContain('إنشاء السجلات محظور')
  })

  it('uses the Arabic verb for updating the device preview', () => {
    const help = get(ar as unknown as Rec, 'access.permissions.mirror.help')
    expect(help).toContain('تُحدَّث')
    expect(help).not.toContain('تتحدّث')
  })
})
