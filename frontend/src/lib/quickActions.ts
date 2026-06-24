/**
 * Quick-action metadata — single source of truth for the 20 dashboard
 * quick-action tiles (4 section shortcuts + 16 service forms).
 *
 * Each entry maps a {@link QuickActionId} to:
 *   - `emoji`  : the tile glyph rendered by `<ServiceTile>`
 *   - `href`   : navigation target. Section shortcuts hit a router path
 *                (`/employees`, `/leaves`, `/books`, `/application`);
 *                form tiles deep-link to `/application?form=<template_id>`
 *                so the picker pre-selects on mount (see ApplicationPage's
 *                `?form=` hydration via `resolveTemplateIdFromSlug`).
 *   - `intent` : `'new'` for form tiles (they open a fresh form),
 *                `'browse'` (or undefined) for section shortcuts.
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
  /** Form tiles always open a fresh form; section tiles browse. */
  intent: 'new' | 'browse'
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
  // ── Section shortcuts (canonical default visible set) ────────────────
  hr: { emoji: '📋', href: '/application', intent: 'browse', slug: 'hr' },
  violations: {
    emoji: '⚖️',
    href: '/employees',
    intent: 'browse',
    slug: 'violations',
  },
  leaves: { emoji: '🏖️', href: '/leaves', intent: 'browse', slug: 'leaves' },
  books: { emoji: '📚', href: '/books', intent: 'browse', slug: 'books' },
  // ── Service forms (deep-link to /application?form=<id>) ──────────────
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
  'Resignation Declaration': {
    emoji: '📝',
    href: formHref('Resignation Declaration'),
    intent: 'new',
    slug: slugifyQuickActionId('Resignation Declaration'),
  },
  'Resignation Letter': {
    emoji: '✉️',
    href: formHref('Resignation Letter'),
    intent: 'new',
    slug: slugifyQuickActionId('Resignation Letter'),
  },
  'Leave Undertaking': {
    emoji: '🤝',
    href: formHref('Leave Undertaking'),
    intent: 'new',
    slug: slugifyQuickActionId('Leave Undertaking'),
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
}
