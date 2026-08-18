/**
 * Quick-action metadata — single source of truth for the 18 dashboard
 * quick-action tiles (one tile per selectable service form).
 *
 * Each entry maps a {@link QuickActionId} to:
 *   - `emoji`  : the tile glyph rendered by `<ServiceTile>`
 *   - `href`   : navigation target. Every tile deep-links to
 *                `/application?form=<slug>` so the picker pre-selects on
 *                mount (see ApplicationPage's `?form=` hydration via
 *                `resolveTemplateIdFromSlug`). Section shortcuts are gone —
 *                the top nav already owns wayfinding, and a tile that only
 *                browsed a list looked identical to one that opened a form.
 *   - `intent` : always `'new'` — every tile opens a fresh form.
 *   - `slug`   : i18n + lookup-safe key for the ID. Template names contain
 *                spaces + capital letters which can't be used directly as
 *                JSON keys for i18next — slugify once here so all consumers
 *                (label map, label desc map, dialog labels) share one
 *                deterministic key.
 *
 * **Why a slug**: i18next does support bracket lookups (`t('a["My Key"]')`)
 * but our existing convention is dotted keys, and we already slugify in
 * `formEmoji.ts` for deep-link resolution. Reusing the same slug rules
 * here keeps the two surfaces (URL ↔ i18n key) in lockstep.
 */

import type { QuickActionId } from './dashboardLayout'

export interface QuickActionMeta {
  /** Tile glyph. */
  emoji: string
  /** Router path or `?form=`-deep-linked URL. */
  href: string
  /** Every tile opens a fresh form. */
  intent: 'new'
  /** Slug used as the i18n key suffix (matches `formEmoji.slugifyTemplate`). */
  slug: string
}

/**
 * Slugify a quick-action id for use as an i18n key suffix.
 *
 * Mirrors `formEmoji.ts::slugifyTemplate` but exposed here so the label /
 * description maps can be built without crossing module boundaries.
 *
 *   "Acknowledgment Form"   → "acknowledgment"
 *   "Salary Transfer Request" → "salary_transfer_request"
 *   "hr"                    → "hr"
 */
export function slugifyQuickActionId(id: string): string {
  return id
    .toLowerCase()
    .replace(/\bform\b/g, '') // drop the redundant trailing "form"
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Build the `?form=...` URL for a form-template id.
 *
 * Emits the **slug** (not the raw id) because ApplicationPage hydrates `?form=`
 * via `resolveTemplateIdFromSlug`, which compares against `slugifyTemplate`d
 * ids — feeding it the raw spaced id (e.g. "Acknowledgment Form") never
 * matched and silently fell back to the gallery. The slug rules here mirror
 * `formEmoji.slugifyTemplate` exactly so the URL ↔ resolver stay in lockstep.
 */
function formHref(templateId: string): string {
  return `/application?form=${encodeURIComponent(slugifyQuickActionId(templateId))}`
}

export const QUICK_ACTION_META: Record<QuickActionId, QuickActionMeta> = {
  // ── Service forms (deep-link to /application?form=<slug>) ────────────
  'Acknowledgment Form': {
    emoji: '✍️',
    href: formHref('Acknowledgment Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Acknowledgment Form'),
  },
  'Salary Transfer Request': {
    emoji: '💰',
    href: formHref('Salary Transfer Request'),
    intent: 'new',
    slug: slugifyQuickActionId('Salary Transfer Request'),
  },
  'Salary Deduction Form': {
    emoji: '💸',
    href: formHref('Salary Deduction Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Salary Deduction Form'),
  },
  'Violation Form': {
    emoji: '🚨',
    href: formHref('Violation Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Violation Form'),
  },
  'Employee Clearance Form': {
    emoji: '✅',
    href: formHref('Employee Clearance Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Employee Clearance Form'),
  },
  'Leave Application Form': {
    emoji: '📅',
    href: formHref('Leave Application Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Leave Application Form'),
  },
  'Passport Release Form': {
    emoji: '📤',
    href: formHref('Passport Release Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Passport Release Form'),
  },
  'Duty Resumption Form': {
    emoji: '🔁',
    href: formHref('Duty Resumption Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Duty Resumption Form'),
  },
  'Material Request Form': {
    emoji: '📦',
    href: formHref('Material Request Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Material Request Form'),
  },
  'General Book': {
    emoji: '📓',
    href: formHref('General Book'),
    intent: 'new',
    slug: slugifyQuickActionId('General Book'),
  },
  'HR Request Form': {
    emoji: '🧑‍💼',
    href: formHref('HR Request Form'),
    intent: 'new',
    slug: slugifyQuickActionId('HR Request Form'),
  },
  'Resignation Letter': {
    emoji: '✉️',
    href: formHref('Resignation Letter'),
    intent: 'new',
    slug: slugifyQuickActionId('Resignation Letter'),
  },
  'Leave Permit Form': {
    emoji: '🎫',
    href: formHref('Leave Permit Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Leave Permit Form'),
  },
  'Administrative Leave Form': {
    emoji: '🗂️',
    href: formHref('Administrative Leave Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Administrative Leave Form'),
  },
  'Warning Form': {
    emoji: '⚠️',
    href: formHref('Warning Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Warning Form'),
  },
  'Passport Release List': {
    emoji: '🛂',
    href: formHref('Passport Release List'),
    intent: 'new',
    slug: slugifyQuickActionId('Passport Release List'),
  },
  Report: {
    emoji: '📊',
    href: formHref('Report'),
    intent: 'new',
    slug: slugifyQuickActionId('Report'),
  },
  'Inmate Conduct Violations': {
    emoji: '⛓️',
    href: formHref('Inmate Conduct Violations'),
    intent: 'new',
    slug: slugifyQuickActionId('Inmate Conduct Violations'),
  },
}
