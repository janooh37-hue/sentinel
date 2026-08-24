/**
 * The name **Save as PDF** offers for a printed register.
 *
 * A browser takes the suggested filename of a printed page from
 * `document.title` — there is no file to name, only the dialog's guess — so the
 * title is swapped when the dialog opens and put straight back when it closes
 * (`usePrintFilename` in `AttendancePrintSheet`). Nothing else about the
 * printout changes: the paper, the data and the filters are untouched.
 *
 * The shape HR files these by:
 *
 *   نوع الكشف_مكان العمل_اليوم_الوردية_التاريخ
 *   كشف تدقيق الحضور_السرية الرابعة_الخميس_صباحية_20-08-2026
 *
 * Four fields plus the date, except where two of them are the same word: the
 * office duty is both the workplace and the shift, and «كشف تدقيق
 * الحضور_الدوام الرسمي_الخميس_الدوام الرسمي_20-08-2026» says it twice, so the
 * duplicate is dropped.
 *
 * Arabic whatever the UI language is, which is why these are constants and not
 * i18n keys: the sheet is filed in an Arabic registry even when the operator
 * happens to be reading the screen in English. The date is the only numeric
 * field, and no extension is added — every browser appends `.pdf` itself.
 */
import type { PrintLayout } from './AttendancePrintSheet'
import type { AttendanceRow } from './attendanceModel'

/**
 * What each layout is called on paper. The three sheets the toolbar prints are
 * three different reports to the people who receive them: the whole day off the
 * biometric mirror, the line-per-assignment audit, and the per-shift sheet a
 * supervisor signs.
 */
const REPORT_NAME: Record<PrintLayout, string> = {
  sheet: 'كشف البصمة العام',
  roster: 'كشف تدقيق الحضور',
  shift: 'كشف الحضور الوظيفي',
}

/**
 * Shift names as the REGISTRY spells them, which is not always what the screen
 * says (`attendance.shift.*`):
 *
 *   - the three rotating duties take the indefinite adjective a filename reads
 *     with — «…_صباحية_20-08-2026», not «…_الصباحية_20-08-2026»;
 *   - `noon` is filed as «مسائية», the word the paper registry has always used
 *     for the 13:00–21:00 duty, while the screen keeps «الظهيرة». Deliberate:
 *     renaming the shift on screen is a change to the register itself, and the
 *     filing cabinet is what this string has to match;
 *   - the office day is not one of the three and keeps its noun phrase.
 *
 * A code added backend-side belongs in BOTH this map and `attendance.shift.*`;
 * an unmapped one falls back rather than putting a Latin enum on an Arabic file.
 */
const SHIFT_NAME: Record<string, string> = {
  morning: 'صباحية',
  noon: 'مسائية',
  night: 'ليلية',
  office_day: 'الدوام الرسمي',
}

/** Indexed by `getUTCDay()`: Sunday first. */
const WEEKDAY: readonly string[] = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
]

/** A field with nothing behind it still has to read as words, never as a hole. */
const UNKNOWN = 'غير محدد'
/** A printout spanning more than one company or shift must not name just one. */
const EVERY_UNIT = 'كل السرايا'
const EVERY_SHIFT = 'كل الورديات'

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * One field of the name, made safe to save.
 *
 * Windows rejects `\ / : * ? " < > |` and control characters outright and drops
 * a trailing dot silently; the underscore is this name's separator, so a unit
 * carrying one would fake a sixth field. Bidi controls go too: a unit name
 * pasted out of Word or typed on an Arabic IME can carry an RLE or an LRM,
 * which reorders the WHOLE name in the download bar and the file manager while
 * looking innocent in the database. Everything unusable collapses to a space,
 * and a field left empty falls back rather than printing `_ _`.
 */
function field(value: string | null | undefined, fallback: string): string {
  const text = (value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/[_\s]+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
  return text === '' ? fallback : text
}

/** The non-empty values present, in first-seen order. */
function distinct(values: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>()
  for (const value of values) {
    const text = (value ?? '').trim()
    if (text !== '') seen.add(text)
  }
  return [...seen]
}

/** One value, a stated plural, or a stated blank — never a silent pick of one. */
function only(values: readonly string[], fallback: string): string | null {
  if (values.length === 1) return values[0] ?? null
  return values.length === 0 ? null : fallback
}

interface Input {
  layout: PrintLayout
  /** The rows actually on the paper: what was filtered is what is named. */
  rows: readonly AttendanceRow[]
  /** `YYYY-MM-DD`, the operational date of the register. */
  operationalDate: string
  /** The active shift filter, which the rows may not show if the day is empty. */
  shiftCode: string | null
}

export function attendancePrintFilename({
  layout,
  rows,
  operationalDate,
  shiftCode,
}: Input): string {
  const match = ISO_DATE.exec(operationalDate)
  const at = match ? new Date(`${operationalDate}T00:00:00Z`) : null
  const dated = at !== null && !Number.isNaN(at.getTime())

  // The filter is authoritative when set: an empty day still prints the shift
  // it was filtered to. A code with no Arabic word yet reads as غير محدد rather
  // than putting a Latin enum value on a file that is otherwise all Arabic.
  const codes = shiftCode !== null ? [shiftCode] : distinct(rows.map((row) => row.shift_code))
  const code = only(codes, EVERY_SHIFT)
  const shift = code !== null && codes.length === 1 ? SHIFT_NAME[code] : code

  const workplace = field(only(distinct(rows.map((row) => row.duty_unit)), EVERY_UNIT), UNKNOWN)
  const duty = field(shift, UNKNOWN)

  return [
    field(REPORT_NAME[layout], UNKNOWN),
    workplace,
    field(dated ? WEEKDAY[at.getUTCDay()] : null, UNKNOWN),
    // The office duty is its own workplace AND its own shift, so naming both
    // spelled «الدوام الرسمي_الخميس_الدوام الرسمي». One field says it — but two
    // blanks are two facts nobody has, not one, so the placeholder never folds.
    ...(duty === workplace && duty !== UNKNOWN ? [] : [duty]),
    // `DD-MM-YYYY`: dashes, because a slash is a path separator on every OS.
    field(match ? `${match[3]}-${match[2]}-${match[1]}` : null, UNKNOWN),
  ].join('_')
}
