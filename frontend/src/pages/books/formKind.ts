/**
 * subjectEmployeePart — splits the employee's name off a generated-form
 * subject for the Records page rail + register rows.
 *
 * The record's service/form type itself comes from the backend
 * (`BookRead.service_id`, rendered via `serviceLabels.ts`) — this module no
 * longer guesses it from the subject string. What's left is purely cosmetic:
 * stripping the "<form> — " prefix so rows can show form (bold) + employee
 * (muted) separately.
 */

export interface FormKindOpts {
  /** Classified General Books carry a REAL operator subject — never parse it
   * as "<form> — <employee>" (a subject containing an em-dash used to display
   * as just its last word, labeled "Other records"). */
  classified?: boolean
}

/** Strip the form-name prefix so rows can show form (bold) + employee (muted).
 * "Leave Application Form - Saif Rashed" → "Saif Rashed"; returns '' when no
 * separator is present or the prefix is shorter than 8 characters (guards
 * against "Re:", "Fwd:", etc.). Separator chars: em-dash (—), colon (:),
 * hyphen (-) — hyphen is last in the class to avoid range interpretation.
 * Classified books return the WHOLE subject — it is not a "<form> — <name>"
 * composite. */
export function subjectEmployeePart(
  subject: string | null | undefined,
  opts?: FormKindOpts,
): string {
  const s = (subject ?? '').trim()
  if (opts?.classified) return s
  const m = s.match(/^([^:—-]{8,}?)\s*[:—-]\s*(.+)$/)
  return m ? m[2].trim() : ''
}
