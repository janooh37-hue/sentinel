/**
 * Quick-action metadata — single source of truth for the 18 dashboard
 * quick-action tiles (one tile per selectable service form).
 *
 * Each entry maps a {@link QuickActionId} to:
 *   - `emoji`  : the tile glyph rendered by `<ServiceTile>`
 *   - `href`   : navigation target. Every tile deep-links to
 *                `/services/<slug>` so the form opens directly (see
 *                ApplicationPage's `:slug` resolution via
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
import type { ServiceArtworkId } from '@/components/ui/service-artwork'

export interface QuickActionMeta {
  /** Tile glyph. */
  emoji: string
  /** Calibrated artwork required for every dashboard service tile. */
  artwork: ServiceArtworkId
  /** Service URL (`/services/<slug>`). */
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
 * The canonical URL of one service form: `/services/<slug>`.
 *
 * Accepts a template id ("Acknowledgment Form") or a slug and emits the
 * **slug**, because ApplicationPage resolves `:slug` via
 * `resolveTemplateIdFromSlug`, which compares `slugifyTemplate`d ids. The slug
 * rules here mirror `formEmoji.slugifyTemplate` exactly so the URL ↔ resolver
 * stay in lockstep.
 */
export function serviceHref(templateIdOrSlug: string): string {
  return `/services/${encodeURIComponent(slugifyQuickActionId(templateIdOrSlug))}`
}

export const QUICK_ACTION_META: Record<QuickActionId, QuickActionMeta> = {
  // ── Service forms (deep-link to /services/<slug>) ────────────
  'Acknowledgment Form': {
    emoji: '✍️',
    artwork: 'acknowledgment',
    href: serviceHref('Acknowledgment Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Acknowledgment Form'),
  },
  'Salary Transfer Request': {
    emoji: '💰',
    artwork: 'salary-transfer',
    href: serviceHref('Salary Transfer Request'),
    intent: 'new',
    slug: slugifyQuickActionId('Salary Transfer Request'),
  },
  'Salary Deduction Form': {
    emoji: '💸',
    artwork: 'salary-deduction',
    href: serviceHref('Salary Deduction Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Salary Deduction Form'),
  },
  'Violation Form': {
    emoji: '🚨',
    artwork: 'violation',
    href: serviceHref('Violation Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Violation Form'),
  },
  'Employee Clearance Form': {
    emoji: '✅',
    artwork: 'employee-clearance',
    href: serviceHref('Employee Clearance Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Employee Clearance Form'),
  },
  'Leave Application Form': {
    emoji: '📅',
    artwork: 'leave-application',
    href: serviceHref('Leave Application Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Leave Application Form'),
  },
  'Passport Release Form': {
    emoji: '📤',
    artwork: 'passport-release',
    href: serviceHref('Passport Release Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Passport Release Form'),
  },
  'Duty Resumption Form': {
    emoji: '🔁',
    artwork: 'duty-resumption',
    href: serviceHref('Duty Resumption Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Duty Resumption Form'),
  },
  'Material Request Form': {
    emoji: '📦',
    artwork: 'material-request',
    href: serviceHref('Material Request Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Material Request Form'),
  },
  'General Book': {
    emoji: '📓',
    artwork: 'general-book',
    href: serviceHref('General Book'),
    intent: 'new',
    slug: slugifyQuickActionId('General Book'),
  },
  'HR Request Form': {
    emoji: '🧑‍💼',
    artwork: 'hr-request',
    href: serviceHref('HR Request Form'),
    intent: 'new',
    slug: slugifyQuickActionId('HR Request Form'),
  },
  'Resignation Letter': {
    emoji: '✉️',
    artwork: 'resignation-letter',
    href: serviceHref('Resignation Letter'),
    intent: 'new',
    slug: slugifyQuickActionId('Resignation Letter'),
  },
  'Leave Permit Form': {
    emoji: '🎫',
    artwork: 'leave-permit',
    href: serviceHref('Leave Permit Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Leave Permit Form'),
  },
  'Administrative Leave Form': {
    emoji: '🗂️',
    artwork: 'administrative-leave',
    href: serviceHref('Administrative Leave Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Administrative Leave Form'),
  },
  'Warning Form': {
    emoji: '⚠️',
    artwork: 'warning',
    href: serviceHref('Warning Form'),
    intent: 'new',
    slug: slugifyQuickActionId('Warning Form'),
  },
  'Passport Release List': {
    emoji: '🛂',
    artwork: 'passport-release-list',
    href: serviceHref('Passport Release List'),
    intent: 'new',
    slug: slugifyQuickActionId('Passport Release List'),
  },
  Report: {
    emoji: '📊',
    artwork: 'report',
    href: serviceHref('Report'),
    intent: 'new',
    slug: slugifyQuickActionId('Report'),
  },
  'Inmate Conduct Violations': {
    emoji: '⛓️',
    artwork: 'inmate-conduct',
    href: serviceHref('Inmate Conduct Violations'),
    intent: 'new',
    slug: slugifyQuickActionId('Inmate Conduct Violations'),
  },
}
