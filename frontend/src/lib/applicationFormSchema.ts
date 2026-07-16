/**
 * buildZodSchema — generates a Zod schema at runtime from a TemplateField array.
 *
 * The generated schema is passed to zodResolver(). This avoids hand-writing
 * one schema per template (16 templates × varying fields).
 *
 * Type mapping:
 *   text / textarea      → z.string().min(1) if required, else optional
 *   date                 → z.string().regex(ISO date)
 *   select               → z.enum(options) if required with opts, else string
 *   checkbox / hand_sign → z.boolean()
 *   number               → z.number() (finite; NaN rejected)
 *   manager_picker       → z.number() if required, else .nullable().optional()
 *   submitter_picker     → z.string().optional()
 *   signature / arabic_rich → z.string().optional()
 */

import { z } from 'zod'
import type { TFunction } from 'i18next'
import type { TemplateField } from '@/components/application/types'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyZod = z.ZodType<any, any>

/**
 * Optional string fields are fed by `<input>`/`<input type=date>`, which yield
 * `""` (not `undefined`) when cleared. `.optional()` only skips validation for
 * `undefined`, so an empty string would still hit the inner validator (e.g. the
 * ISO-date regex) and block a non-required field. Normalise `""` → `undefined`
 * first so a blank value is genuinely treated as absent.
 */
function emptyToUndefined(inner: AnyZod): AnyZod {
  return z.preprocess((v) => (v === '' ? undefined : v), inner.optional())
}

function buildShape(fields: TemplateField[], t: TFunction): Record<string, AnyZod> {
  const shape: Record<string, AnyZod> = {}

  for (const field of fields) {
    const { id, type, required, options } = field

    switch (type) {
      case 'text':
      case 'textarea':
        shape[id] = required
          ? z.string().min(1, { message: t('application.validation.required') })
          : emptyToUndefined(z.string())
        break

      case 'date':
        shape[id] = required
          ? z.string().regex(ISO_DATE, { message: t('application.validation.invalidDate') })
          : emptyToUndefined(
              z.string().regex(ISO_DATE, { message: t('application.validation.invalidDate') }),
            )
        break

      case 'select': {
        const opts = options ?? []
        if (required && opts.length > 0) {
          shape[id] = z.enum(opts as [string, ...string[]])
        } else {
          shape[id] = emptyToUndefined(z.string())
        }
        break
      }

      case 'checkbox':
      case 'hand_sign_checkbox':
        // Round 2 — Fix E: `hand_sign_checkbox` keys still bind to the field
        // id (e.g. "hand_sign_employee") but the value now means "embed
        // signature" — flipped semantics, same wire shape.
        shape[id] = z.boolean().default(false)
        break

      case 'number':
        // `<input type=number>` writes NaN (not undefined) when cleared, and
        // `z.number()` accepts NaN. Require a finite number for required fields;
        // for optional ones treat NaN/undefined as absent.
        shape[id] = required
          ? z
              .number({ message: t('application.validation.required') })
              .refine(Number.isFinite, { message: t('application.validation.required') })
          : z.preprocess(
              (v) => (typeof v === 'number' && !Number.isFinite(v) ? undefined : v),
              z.number().optional(),
            )
        break

      case 'manager_picker':
        // The picker stores a manager id (number) or null for "no manager".
        // Only enforce a selection when the field is marked required — otherwise
        // the asterisk shown by ManagerPickerField would be misleading.
        shape[id] = required
          ? z
              .number({ message: t('application.validation.required') })
              .int()
          : z.number().nullable().optional()
        break

      case 'submitter_picker':
        shape[id] = emptyToUndefined(z.string())
        break

      case 'recipient_picker':
        shape[id] = z.number().nullable().optional()
        break

      case 'recipient_multi_picker':
        // CC on General Book — array of recipient *names* (strings). Backend
        // joins them into the {{ cc }} token. Empty array means no CC line.
        shape[id] = z.array(z.string()).default([])
        break

      case 'signature':
      case 'arabic_rich':
      case 'arabic_rich_full':
        shape[id] = z.string().optional()
        break

      case 'items_table': {
        const row = z.object({
          sno: z.string().optional(),
          code: z.string().optional(),
          description: z.string().optional(),
          unit: z.string().optional(),
          qty: z.string().optional(),
          quantity: z.string().optional(),
          remarks: z.string().optional(),
        })
        shape[id] = required
          ? z.array(row).min(1, { message: t('application.validation.required') })
          : z.array(row).optional()
        break
      }

      case 'violation_checkboxes': {
        const v = z.object({ row: z.number(), name: z.string() })
        shape[id] = required
          ? z.array(v).min(1, { message: t('application.validation.required') })
          : z.array(v).optional()
        break
      }

      case 'violation_combo':
        // Warning Form — array of localized/custom violation-type strings.
        // The backend joins them with the Arabic comma into {{ violation_type }}.
        shape[id] = required
          ? z
              .array(z.string())
              .min(1, { message: t('application.validation.required') })
          : z.array(z.string()).default([])
        break

      case 'employees_table': {
        const erow = z.object({
          employee_id: z.string(),
          name: z.string(),
          nationality: z.string().optional(),
          passport_no: z.string().optional(),
        })
        shape[id] = required
          ? z
              .array(erow)
              .min(1, { message: t('application.validation.required') })
              .max(15, {
                message: t('application.employeesTable.max', {
                  defaultValue: 'Up to 15 employees.',
                }),
              })
          : z
              .array(erow)
              .max(15, {
                message: t('application.employeesTable.max', {
                  defaultValue: 'Up to 15 employees.',
                }),
              })
              .optional()
        break
      }

      case 'clearance_table':
        shape[id] = z
          .object({
            clearance_marks: z.record(z.string(), z.boolean()).default({}),
            clearance_remarks: z.record(z.string(), z.string()).default({}),
          })
          .optional()
        break

      default:
        shape[id] = z.unknown().optional()
        break
    }
  }

  return shape
}

export function buildZodSchema(fields: TemplateField[], t: TFunction): z.ZodObject<z.ZodRawShape> {
  return z.object(buildShape(fields, t) as z.ZodRawShape)
}
