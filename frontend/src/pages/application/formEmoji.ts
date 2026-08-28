/**
 * formEmoji — central lookup for the emoji shown on each form tile in the
 * Services gallery, plus a slug→id resolver for deep-link query params.
 *
 * The emoji are sourced from the canonical `quickActions.ts` map so the
 * Services gallery and the dashboard quick-action tiles never drift apart.
 *
 * Slug rules (used by `?form=` query param):
 *   - lowercased name_en
 *   - non-alphanumerics collapsed to underscores
 *   - " Form" suffix stripped (so "Leave Application Form" → "leave_application")
 *
 * If a slug doesn't resolve, the resolver returns null and the page falls
 * back to the gallery — same as a fresh visit.
 */

import type { ServiceArtworkId } from '@/components/ui/service-artwork'
import type { TemplateMeta } from '@/lib/api'
import { QUICK_ACTION_META, type QuickActionMeta } from '@/lib/quickActions'

const DEFAULT_EMOJI = '📄'

/**
 * Emoji for templates that aren't dashboard quick-actions. Empty now that the
 * quick-action catalog is services-only — every selectable template ships a
 * tile in `QUICK_ACTION_META`. Kept as the registration point for a future
 * template that deliberately gets no tile. Wayfinding per DESIGN principle 1:
 * glyphs stay unique across both maps (formEmoji.test.ts).
 */
export const EXTRA_TEMPLATE_EMOJI: Record<string, string> = {}

/**
 * Look up the emoji for a template id. The id is the canonical name used by
 * `TEMPLATE_FILES` in `backend/app/core/constants.py`, which matches the
 * form-tile keys in `QUICK_ACTION_META`. Falls back to a generic doc icon.
 */
export function emojiForTemplate(id: string): string {
  const meta = (QUICK_ACTION_META as Record<string, { emoji: string } | undefined>)[id]
  return meta?.emoji ?? EXTRA_TEMPLATE_EMOJI[id] ?? DEFAULT_EMOJI
}

/** Calibrated artwork for a template id; undefined for ids without artwork. */
export function artworkForTemplate(id: string): ServiceArtworkId | undefined {
  const meta = (QUICK_ACTION_META as Record<string, QuickActionMeta | undefined>)[id]
  return meta?.artwork
}

/**
 * Turn a template's canonical name into a URL-friendly slug.
 *   "Leave Application Form" → "leave_application"
 *   "HR Request Form"        → "hr_request"
 *   "General Book"           → "general_book"
 */
function slugifyTemplate(idOrName: string): string {
  return idOrName
    .toLowerCase()
    .replace(/\bform\b/g, '') // drop the redundant trailing "form"
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Given a deep-link slug from `?form=`, find the matching template id.
 * Tolerant of with/without the trailing "_form" suffix.
 */
export function resolveTemplateIdFromSlug(
  slug: string,
  templates: readonly TemplateMeta[],
): string | null {
  const target = slug.toLowerCase().replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  // Allow both "leave_application" and "leave_application_form".
  const candidates = new Set([target, target.replace(/_form$/, '')])
  for (const tpl of templates) {
    if (candidates.has(slugifyTemplate(tpl.id))) return tpl.id
    if (candidates.has(slugifyTemplate(tpl.name_en))) return tpl.id
  }
  return null
}
