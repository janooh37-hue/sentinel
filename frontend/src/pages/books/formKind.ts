/**
 * Form-kind derivation for the Records page rail + register rows.
 *
 * Books carry only a coarse category; the *form type* lives in the subject
 * string the backend derives from version fields ("Leave Application Form -
 * <employee>"). We match known prefixes (case-insensitive) and fall back to a
 * generic kind. Glyphs are wayfinding per the Services-tile convention
 * (DESIGN principle 1) — keep them.
 */

export interface FormKind {
  id: string
  glyph: string
  /** i18n key under books.formKind.* */
  labelKey: string
  /** lower-case subject prefixes that select this kind */
  prefixes: string[]
}

export const FORM_KINDS: FormKind[] = [
  { id: 'leave', glyph: '🌴', labelKey: 'books.formKind.leave', prefixes: ['leave application'] },
  { id: 'salary', glyph: '💵', labelKey: 'books.formKind.salary', prefixes: ['salary transfer'] },
  { id: 'duty', glyph: '🔄', labelKey: 'books.formKind.duty', prefixes: ['duty resumption'] },
  { id: 'hr', glyph: '📋', labelKey: 'books.formKind.hr', prefixes: ['hr request'] },
  { id: 'passport', glyph: '🛂', labelKey: 'books.formKind.passport', prefixes: ['passport release'] },
  { id: 'material', glyph: '📦', labelKey: 'books.formKind.material', prefixes: ['material request'] },
]

export const OTHER_KIND: FormKind = {
  id: 'other',
  glyph: '📄',
  labelKey: 'books.formKind.other',
  prefixes: [],
}

/** Classified General Books (classification_code set) — Word or rich path. */
export const GENERAL_BOOK_KIND: FormKind = {
  id: 'general_book',
  glyph: '📓',
  labelKey: 'books.formKind.generalBook',
  prefixes: [],
}

export interface FormKindOpts {
  /** Classified General Books carry a REAL operator subject — never parse it
   * as "<form> — <employee>" (a subject containing an em-dash used to display
   * as just its last word, labeled "Other records"). */
  classified?: boolean
}

export function formKindOf(
  subject: string | null | undefined,
  opts?: FormKindOpts,
): FormKind {
  if (opts?.classified) return GENERAL_BOOK_KIND
  const s = (subject ?? '').trim().toLowerCase()
  if (!s) return OTHER_KIND
  for (const kind of FORM_KINDS) {
    if (kind.prefixes.some((p) => s.startsWith(p))) return kind
  }
  return OTHER_KIND
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
