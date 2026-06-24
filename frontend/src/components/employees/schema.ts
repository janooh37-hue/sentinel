/**
 * Zod schema mirroring `EmployeeCreate` / `EmployeeUpdate`.
 *
 * Front-of-mind invariants:
 *   * Canonical statuses ("Active" | "Resigned" | "Terminated") — UI shows
 *     bilingual labels via i18n, but the wire/DB value is the English key.
 *   * status ≠ Active ⇒ end_date is required (mirrors the Pydantic validator
 *     and v3.5.4's `_emp_sync_end_date_widget`). Failing this client-side
 *     gives an instant error while the server still validates.
 */

import { z } from 'zod'

export const EMPLOYEE_STATUSES = ['Active', 'Resigned', 'Terminated'] as const
export type EmployeeStatusKey = (typeof EMPLOYEE_STATUSES)[number]

// Strings come in as either ISO yyyy-MM-dd (HTML date input) or empty; we
// normalise empties to null so the API gets a clean shape.
const optionalDate = z
  .string()
  .trim()
  .max(10)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null))

const optionalText = (max = 256) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null))

export const employeeFormSchema = z
  .object({
    id: z.string().trim().min(1).max(16),
    name_en: z.string().trim().min(1).max(256),
    name_ar: optionalText(),
    dob: optionalDate,
    doj: optionalDate,
    doj_company: optionalDate,
    status: z.enum(EMPLOYEE_STATUSES),
    end_date: optionalDate,
    department: optionalText(128),
    position: optionalText(128),
    position_ar: optionalText(128),
    other: optionalText(),
    notes: optionalText(2048),
    passport_no: optionalText(64),
    uae_id_no: optionalText(32),
    nationality: optionalText(64),
    contact: optionalText(64),
    passport_expiry: optionalDate,
    uae_id_expiry: optionalDate,
  })
  .superRefine((data, ctx) => {
    if (data.status !== 'Active' && !data.end_date) {
      ctx.addIssue({
        code: 'custom',
        path: ['end_date'],
        message: 'endDateRequired',
      })
    }
  })

export type EmployeeFormValues = z.input<typeof employeeFormSchema>
export type EmployeeFormOutput = z.output<typeof employeeFormSchema>
