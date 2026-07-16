/**
 * Shared types for the Application tab field components.
 *
 * Aligned with the actual backend schema (api.types.ts generated from OpenAPI).
 * - `TemplateField` maps the backend `TemplateField` schema (key → we alias
 *   as `id` for convenience in field components that use `name={field.id}`).
 * - `TemplateDetailResponse` wraps `meta` + `fields` per the backend contract.
 */

import type { components } from '@/lib/api.types'

// Re-export generated types for convenience
export type TemplateMeta = components['schemas']['TemplateMeta']
export type ManagerRead = components['schemas']['ManagerRead']
export type SubmitterRead = components['schemas']['SubmitterRead']
export type DocumentRead = components['schemas']['DocumentRead']
export type JobStatus = components['schemas']['JobStatusResponse']

// Backend field type union (from generated schema)
type _BackendFieldType = components['schemas']['TemplateField']['type']

// Frontend-facing field type extends backend with legacy client types.
// The TemplateForm switch-case covers all of these.
export type FieldType =
  | _BackendFieldType
  | 'checkbox'          // not in current backend but TemplateForm handles it
  | 'number'            // not in current backend but TemplateForm handles it
  | 'select'            // not in current backend but TemplateForm handles it
  | 'recipient_picker'  // general-book recipient combobox (forms-fix)
  | 'recipient_multi_picker' // general-book CC: multi-select recipient chips
  | 'violation_combo'   // warning-form: multi-select violation types + custom
  | 'employees_table'   // passport-release list: multi-employee G-number picker

export interface TemplateField {
  /** `key` from the backend — aliased as `id` for field-component compatibility */
  id: string
  label_en: string
  label_ar: string
  type: FieldType
  required?: boolean
  options?: string[]
  default?: string
  group?: string
}

export interface TemplateDetailResponse {
  meta: TemplateMeta
  needs_manager: boolean
  needs_submitter: boolean
  fields: TemplateField[]
}

/** Base props every field component accepts */
export interface FieldProps {
  name: string
  label_en: string
  label_ar: string
  required?: boolean
}
