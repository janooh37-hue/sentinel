/**
 * Records page → email basket integration.
 *
 * STEP 0 findings:
 * - `BookRead` (list endpoint) includes `versions[]` with `document_id` and
 *   `template_id`, so no extra `getBook()` call is needed for basic info.
 * - `BookRead` does NOT expose `employee_id` (subject employee); the subject
 *   employee's name is parsed from `row.subject` via `subjectEmployeePart`.
 * - Version fields (via `getBookVersionFields`) may carry `employee_id` for
 *   per-employee forms, but the endpoint requires `books.manage` capability.
 *   When available it also carries `leave_type` for leave forms.
 * - When fields are unavailable (no fields, or cap not held), we fall back to
 *   `subjectEmployeePart(book.subject)` for the name and leave type from the
 *   subject prefix.
 */

import type { BookRead, BookVersionRead, EmployeeRead } from '@/lib/api'
import { api } from '@/lib/api'
import type { EmailBasketItem } from '@/lib/emailBasket'
import { subjectEmployeePart } from './formKind'

// ---------------------------------------------------------------------------
// Pure derivation (unit-testable — no network)
// ---------------------------------------------------------------------------

export interface RecordDetailInput {
  book: Pick<BookRead, 'id' | 'ref_number' | 'subject' | 'employee_id'>
  cur: Pick<BookVersionRead, 'document_id' | 'template_id'>
  fields: Record<string, unknown>
  emp:
    | (Pick<EmployeeRead, 'name_en' | 'name_ar'> &
        Partial<Pick<EmployeeRead, 'position' | 'position_ar' | 'nationality' | 'contact' | 'doj'>>)
    | null
}

/**
 * Pure mapper: given enriched detail, produce an `EmailBasketItem` or null.
 * Returns null when there is no PDF to attach (no `document_id`).
 */
export function deriveRecordItem({
  book,
  cur,
  fields,
  emp,
}: RecordDetailInput): EmailBasketItem | null {
  if (cur.document_id == null) return null

  // Employee name: prefer the live employee record; fall back to subject parse.
  const nameEn = emp?.name_en ?? subjectEmployeePart(book.subject) ?? ''
  const nameAr = emp?.name_ar ?? null

  // Employee id (الرقم الوظيفي): the Book row's own employee link is the
  // canonical source; fall back to the form fields, then empty string.
  const employeeId =
    typeof book.employee_id === 'string' && book.employee_id
      ? book.employee_id
      : typeof fields['employee_id'] === 'string'
        ? fields['employee_id']
        : typeof fields['g_number'] === 'string'
          ? fields['g_number']
          : ''

  // Form kind: prefer the stored template_id; fall back to empty string.
  const formKind = cur.template_id ?? ''

  // Leave type: only for leave forms.
  let leaveType: string | undefined
  if (
    cur.template_id === 'Leave Application Form' &&
    typeof fields['leave_type'] === 'string' &&
    fields['leave_type']
  ) {
    // Stored as "Annual Leave", "Sick Leave", etc. — keep only the first word
    // so it aligns with the basket key convention ("Annual", "Sick", …).
    leaveType = String(fields['leave_type']).split(' ')[0]
  }

  // Period dates (leave forms) — drive From/To columns + the Leave-Days count.
  const startDate = typeof fields['start_date'] === 'string' ? fields['start_date'] : undefined
  const endDate = typeof fields['end_date'] === 'string' ? fields['end_date'] : undefined

  // Detail: period range if fields carry it, else fall back to subject.
  const detail =
    startDate && endDate
      ? `${startDate} → ${endDate}`
      : (book.subject ?? book.ref_number)

  return {
    bookId: book.id,
    docId: cur.document_id,
    ref: book.ref_number,
    employeeId,
    nameEn,
    nameAr,
    formKind,
    leaveType,
    detail,
    startDate,
    endDate,
    positionEn: emp?.position ?? undefined,
    positionAr: emp?.position_ar ?? undefined,
    nationality: emp?.nationality ?? undefined,
    bankName: typeof fields['bank_name'] === 'string' ? fields['bank_name'] : undefined,
    phone: emp?.contact ?? undefined,
    joinDate: emp?.doj ?? undefined,
    resumptionDate:
      typeof fields['resumption_date'] === 'string' ? fields['resumption_date'] : undefined,
    lastWorkDay:
      typeof fields['last_work_day'] === 'string'
        ? fields['last_work_day']
        : typeof fields['last_working_day'] === 'string'
          ? fields['last_working_day']
          : undefined,
  }
}

// ---------------------------------------------------------------------------
// Async builder (fetches fields + employee when needed)
// ---------------------------------------------------------------------------

/**
 * Build an `EmailBasketItem` for a book already in the list cache.
 *
 * The `book` arg is the `BookRead` from the list (already includes `versions`).
 * Fetches the version fields (leave_type/period/employee_id → drive the styled
 * email columns), and the employee record when an `employee_id`/`g_number` key
 * is present. Returns null when the current version has no `document_id`.
 *
 * NOTE: we DON'T gate the fields fetch on `cur.has_fields` — the LIST endpoint
 * always serialises `has_fields=false` (only GET /books/{id} rebuilds it), so
 * gating on it would silently drop leave_type/dates here. The fetch is cheap for
 * the handful of records in a bulk add and the try/catch covers fieldless forms
 * + a missing `books.manage` cap.
 */
export async function buildRecordBasketItem(
  book: BookRead,
): Promise<EmailBasketItem | null> {
  const cur = book.versions?.at(-1)
  if (!cur?.document_id) return null

  let fields: Record<string, unknown> = {}
  try {
    const res = await api.getBookVersionFields(book.id, cur.id)
    fields = res.fields
  } catch {
    // Fieldless form, or the caller lacks books.manage — proceed without fields.
  }

  let emp: EmployeeRead | null = null
  // The Book's own employee link is the reliable source for designation
  // (المسمى الوظيفي), Arabic name and G-number; the form fields are a fallback.
  const rawEmpId = book.employee_id ?? fields['employee_id'] ?? fields['g_number']
  if (rawEmpId != null && String(rawEmpId).trim()) {
    try {
      emp = await api.getEmployee(String(rawEmpId))
    } catch {
      // Employee not found or unreachable — use subject-name fallback
    }
  }

  return deriveRecordItem({ book, cur, fields, emp })
}
