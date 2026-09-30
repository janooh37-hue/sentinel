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
 * Emoji for templates that aren't dashboard quick-actions. Feature-minted
 * forms are excluded from the manual gallery, but still use these glyphs in
 * Records-facing template metadata.
 */
export const EXTRA_TEMPLATE_EMOJI: Record<string, string> = {
  'Vehicle Fines': '🚗',
  'Vehicle Accident Report': '🚧',
  'Manpower Requisition Form': '👥',
  'Employment Application Form': '📝',
  'Interview Assessment Form': '💬',
  'Employment Offer Letter': '🤝',
  'Employee Performance Appraisal Form': '⭐',
  'Employee Job Description': '💼',
  'Interview Scores Form': '💯',
  'Staff Attendance Form': '🕘',
  'Leave Encashment Form': '🏖️',
  'Loan Request Form': '🏦',
  'Employee Information Form': '🪪',
  'Employee Exit Form': '🚪',
  'Employee Exit Form – Project or Contract': '📜',
  'Salary Advance Request Form': '💵',
  'Breach of Discipline Form': '⚖️',
  'Promotion and Salary Increment Request Form': '📈',
  'Allowance Request Form': '🪙',
  'Employee Overtime Form': '🌙',
  'Expense Claim Form': '🧾',
}

/** Calibrated artwork for templates that are not dashboard quick actions. */
export const EXTRA_TEMPLATE_ARTWORK: Record<string, ServiceArtworkId> = {
  'Vehicle Fines': 'vehicle-fines',
  'Vehicle Accident Report': 'vehicle-accident',
  'Manpower Requisition Form': 'manpower-requisition',
  'Employment Application Form': 'employment-application',
  'Interview Assessment Form': 'interview-assessment',
  'Employment Offer Letter': 'employment-offer',
  'Employee Performance Appraisal Form': 'performance-appraisal',
  'Employee Job Description': 'job-description',
  'Interview Scores Form': 'interview-scores',
  'Staff Attendance Form': 'staff-attendance',
  'Leave Encashment Form': 'leave-encashment',
  'Loan Request Form': 'loan-request',
  'Employee Information Form': 'employee-information',
  'Employee Exit Form': 'employee-exit',
  'Employee Exit Form – Project or Contract': 'employee-exit-contract',
  'Salary Advance Request Form': 'salary-advance',
  'Breach of Discipline Form': 'breach-of-discipline',
  'Promotion and Salary Increment Request Form': 'promotion-increment',
  'Allowance Request Form': 'allowance-request',
  'Employee Overtime Form': 'employee-overtime',
  'Expense Claim Form': 'expense-claim',
}

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
  return meta?.artwork ?? EXTRA_TEMPLATE_ARTWORK[id]
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
