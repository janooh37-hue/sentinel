/**
 * Quick-action deep-link contract.
 *
 * Every tile must open a pre-selected form. Two ways that has broken before:
 * a tile whose `href` pointed at a section list instead of `/application`, and
 * an `href` built from the raw template name ("Acknowledgment Form") which the
 * `?form=` resolver — comparing slugs — never matched, so the tile silently
 * landed on the gallery. The URL is produced by `quickActions.formHref`; the
 * lookup is done independently by `resolveTemplateIdFromSlug`. This asserts
 * the two still agree for every id in the catalog.
 */

import { describe, expect, it } from 'vitest'

import type { TemplateMeta } from '@/lib/api'
import { QUICK_ACTION_IDS } from '@/lib/dashboardLayout'
import { QUICK_ACTION_META } from '@/lib/quickActions'
import { resolveTemplateIdFromSlug } from '@/pages/application/formEmoji'

// The gallery feeds the resolver whatever `GET /templates` returns; ids are the
// canonical `TEMPLATE_FILES` keys, which is what the catalog is keyed by too.
const TEMPLATES = QUICK_ACTION_IDS.map(
  (id) => ({ id, name_en: id }) as unknown as TemplateMeta,
)

describe('quick actions', () => {
  it('gives every catalogued id a form-opening tile', () => {
    for (const id of QUICK_ACTION_IDS) {
      const meta = QUICK_ACTION_META[id]
      expect(meta, id).toBeDefined()
      expect(meta.intent, id).toBe('new')
    }
  })

  it('deep-links every tile to its own template, never to a section list', () => {
    for (const id of QUICK_ACTION_IDS) {
      const { href } = QUICK_ACTION_META[id]
      const match = /^\/application\?form=([^&]+)$/.exec(href)
      expect(match, `${id} -> ${href}`).not.toBeNull()

      const slug = decodeURIComponent(match![1]!)
      expect(resolveTemplateIdFromSlug(slug, TEMPLATES), `${id} -> ${href}`).toBe(id)
    }
  })
})
