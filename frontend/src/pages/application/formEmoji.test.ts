/**
 * Regression test for the 🚨 collision caught in Task 6 review: `formEmoji.ts`
 * (`EXTRA_TEMPLATE_EMOJI`) and `quickActions.ts` (`QUICK_ACTION_META`) are two
 * separate maps feeding the same Services-gallery glyph lookup
 * (`emojiForTemplate`), so nothing stopped one map from reusing a glyph the
 * other already assigned — exactly what happened with 'Violation Form' and
 * 'Inmate Conduct Violations' both getting 🚨. This asserts the invariant
 * `formEmoji.ts`'s own docstring promises (wayfinding: each tile distinct)
 * across BOTH maps combined, not just within one of them.
 */

import { describe, expect, it } from 'vitest'

import { QUICK_ACTION_META } from '@/lib/quickActions'
import { artworkForTemplate, EXTRA_TEMPLATE_EMOJI } from './formEmoji'

describe('Services-gallery glyph registry', () => {
  it('assigns every template id a unique glyph across QUICK_ACTION_META and EXTRA_TEMPLATE_EMOJI', () => {
    const idsByEmoji = new Map<string, string[]>()
    for (const [id, meta] of Object.entries(QUICK_ACTION_META)) {
      idsByEmoji.set(meta.emoji, [...(idsByEmoji.get(meta.emoji) ?? []), id])
    }
    for (const [id, emoji] of Object.entries(EXTRA_TEMPLATE_EMOJI)) {
      idsByEmoji.set(emoji, [...(idsByEmoji.get(emoji) ?? []), id])
    }

    const collisions = [...idsByEmoji.entries()].filter(([, ids]) => ids.length > 1)
    expect(collisions).toEqual([])
  })
})

describe('Services-gallery artwork registry', () => {
  it('resolves calibrated artwork for service templates and leaves unknown ids unset', () => {
    expect(artworkForTemplate('Report')).toBe('report')
    expect(artworkForTemplate('Warning Form')).toBe('warning')
    expect(artworkForTemplate('Nope')).toBeUndefined()
  })
})
