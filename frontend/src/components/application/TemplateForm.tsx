/**
 * TemplateForm — dispatches field schema → field components.
 *
 * Takes the field list from GET /api/v1/templates/{id}/fields and an RHF
 * UseFormReturn instance from the parent, then renders the right component
 * per field type. Fields are grouped by their `group` attribute when present.
 *
 * The parent (ApplicationPage / chunk H) owns the useForm() call so it can
 * drive submission. This component is purely presentational.
 */

import { useEffect, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { FormProvider } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api } from '@/lib/api'
import { useLeaveDateMath } from '@/lib/useLeaveDateMath'
import { ExtractionDropzone } from '@/components/extraction/ExtractionDropzone'
import { ExtractionReviewPanel } from '@/components/extraction/ExtractionReviewPanel'
import { CapabilityGate } from '@/components/shell/CapabilityGate'
import type { ExtractionResponse } from '@/lib/extraction'
import type { TemplateDetailResponse, TemplateField } from './types'
import { findViolationOthersField } from './templateFieldHelpers'
import { TextField } from './fields/TextField'
import { TextareaField } from './fields/TextareaField'
import { DateField } from './fields/DateField'
import { SelectField } from './fields/SelectField'
import { NumberField } from './fields/NumberField'
import { CheckboxField } from './fields/CheckboxField'
import { ManagerPickerField } from './fields/ManagerPickerField'
import { SubmitterPickerField } from './fields/SubmitterPickerField'
import { RecipientPickerField } from './fields/RecipientPickerField'
import { MultiRecipientPickerField } from './fields/MultiRecipientPickerField'
import { EmbedSignatureCheckbox } from './fields/EmbedSignatureCheckbox'
import { SignatureField } from './fields/SignatureField'
import { EmployeeSignatureCard } from './fields/EmployeeSignatureCard'
import { RichEditor } from '@/components/ui/rich-editor'
import { GENERAL_BOOK_PAGE_VIEW } from '@/components/ui/rich-editor-config'
import { ClearanceTableField } from './fields/ClearanceTableField'
import { ItemsTableField } from './fields/ItemsTableField'
import { EmployeesTableField } from './fields/EmployeesTableField'
import { ViolationCheckboxesField } from './fields/ViolationCheckboxesField'
import { ViolationComboField } from './fields/ViolationComboField'

export interface TemplateFormProps {
  templateId: string
  schema: TemplateDetailResponse
  // The parent owns useForm(); we accept any shape via the generic.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>
  /** Employee id for the selected employee — used by the save-IBAN feature. */
  employeeId?: string | null
  /** Pre-seed the scan panel from an injected extraction (intake flow). */
  initialExtraction?: ExtractionResponse
  /** Called once after the initialExtraction has been consumed, so the parent
   *  can clear the pending injection and avoid re-seeding on re-renders. */
  onExtractionConsumed?: () => void
}

/**
 * Pair a signature field with its sibling hand_sign_checkbox so they render as
 * a single card. Convention: `employee_sig_path` ↔ `hand_sign_employee`,
 * `manager_sig_path` ↔ `hand_sign_manager`. Returns the hand-sign field id
 * (and labels) when a paired control exists in this schema, else null.
 */
function findPairedHandSign(
  field: TemplateField,
  fields: TemplateField[],
): TemplateField | null {
  if (field.type !== 'signature') return null
  // signature key looks like "<entity>_sig_path"; expected pair "hand_sign_<entity>"
  const m = field.id.match(/^(.+)_sig_path$/)
  if (!m) return null
  const entity = m[1]
  // Manager embedding is server-enforced (form_policy) — never surface a
  // manager embed toggle, even hosted inside a signature card.
  if (entity === 'manager') return null
  return (
    fields.find(
      (f) => f.type === 'hand_sign_checkbox' && f.id === `hand_sign_${entity}`,
    ) ?? null
  )
}

function renderField(
  field: TemplateField,
  fields: TemplateField[],
  employeeId?: string | null,
  templateId?: string,
): React.ReactNode {
  const common = {
    name: field.id,
    label_en: field.label_en,
    label_ar: field.label_ar,
    required: field.required,
  }

  // Don't render the Violation Form's `explanation` textarea standalone — the
  // violation grid hosts it inside the "Others" reveal.
  const othersField = findViolationOthersField(fields)
  if (
    othersField &&
    field.id === othersField.id &&
    field.type !== 'violation_checkboxes'
  ) {
    return null
  }

  // Manager embedding is policy-enforced server-side (form_policy, spec
  // 2026-06-11 §3): generate_document derives embed_signature["manager"] from
  // the form's signing path and ignores the client flag — so never render a
  // manager hand-sign checkbox. (No template ships one in _fields.json today;
  // this guard is future-proofing in case one is ever added.)
  if (field.type === 'hand_sign_checkbox' && field.id === 'hand_sign_manager') {
    return null
  }

  // Don't render a hand_sign_checkbox standalone if there's a paired signature
  // — SignatureField will host it inside the card instead.
  if (field.type === 'hand_sign_checkbox') {
    const entity = field.id.replace(/^hand_sign_/, '')
    const pairedSig = fields.find(
      (f) => f.type === 'signature' && f.id === `${entity}_sig_path`,
    )
    if (pairedSig) return null
  }

  switch (field.type) {
    case 'text':
      return <TextField key={field.id} {...common} />

    case 'textarea':
      return <TextareaField key={field.id} {...common} />

    case 'date':
      return <DateField key={field.id} {...common} />

    case 'select':
      return (
        <SelectField
          key={field.id}
          {...common}
          options={field.options ?? []}
        />
      )

    case 'number':
      return <NumberField key={field.id} {...common} />

    case 'checkbox':
      return <CheckboxField key={field.id} {...common} />

    case 'manager_picker':
      return <ManagerPickerField key={field.id} {...common} />

    case 'submitter_picker':
      return <SubmitterPickerField key={field.id} {...common} />

    case 'recipient_picker':
      return <RecipientPickerField key={field.id} {...common} />

    case 'recipient_multi_picker':
      return <MultiRecipientPickerField key={field.id} {...common} />

    case 'hand_sign_checkbox':
      // Renamed to EmbedSignatureCheckbox in Round 2 — Fix E, but the field
      // type string remains "hand_sign_checkbox" for backwards-compat with
      // the existing _fields.json. The checkbox now binds to
      // `embed_signature.<entity>` and means "embed my saved signature".
      return <EmbedSignatureCheckbox key={field.id} {...common} />

    case 'signature': {
      const paired = findPairedHandSign(field, fields)
      // Employee signature with a selected employee → the redesigned card
      // (vault-backed saved signature + printed-cell preview + auto-embed).
      // The key includes the employee id so a switch remounts cleanly.
      if (field.id === 'employee_sig_path' && paired && employeeId) {
        return (
          <EmployeeSignatureCard
            key={`${field.id}:${employeeId}`}
            name={field.id}
            embedName={paired.id}
            employeeId={employeeId}
            hasCompanion={templateId === 'Leave Application Form'}
          />
        )
      }
      // Fallback (admin-category forms with no employee, manager signature).
      return (
        <SignatureField
          key={field.id}
          {...common}
          embedToggleName={paired?.id}
          embedToggleLabelEn={paired?.label_en}
          embedToggleLabelAr={paired?.label_ar}
        />
      )
    }

    case 'arabic_rich':
      return (
        <RichEditor
          key={field.id}
          {...common}
          variant="minimal"
          defaultValue={field.default}
        />
      )

    case 'arabic_rich_full':
      // 600 px body editor for General Book — the A4 page-view canvas
      // (guides + page-break bar) previews the printed layout; the editor
      // frame itself stays 600px and scrolls.
      return (
        <RichEditor
          key={field.id}
          {...common}
          variant="full"
          defaultValue={field.default}
          height={600}
          pageView={GENERAL_BOOK_PAGE_VIEW}
        />
      )

    case 'clearance_table':
      return <ClearanceTableField key={field.id} {...common} />

    case 'items_table':
      return <ItemsTableField key={field.id} {...common} />

    case 'employees_table':
      return <EmployeesTableField key={field.id} {...common} />

    case 'violation_checkboxes':
      return (
        <ViolationCheckboxesField
          key={field.id}
          {...common}
          othersName={findViolationOthersField(fields)?.id}
        />
      )

    case 'violation_combo':
      return <ViolationComboField key={field.id} {...common} />

    default: {
      const unknownType = (field as TemplateField).type
      console.warn(`[TemplateForm] Unknown field type "${String(unknownType)}" for "${field.id}"`)
      return null
    }
  }
}

export function TemplateForm({
  templateId,
  schema,
  form,
  employeeId,
  initialExtraction,
  onExtractionConsumed,
}: TemplateFormProps): React.JSX.Element {
  const { t } = useTranslation()

  // --- Scan-to-fill state ---
  // Seed from initialExtraction (intake injection) on mount; the parent clears
  // its copy via onExtractionConsumed so re-renders don't re-seed.
  const [extractionResult, setExtractionResult] = useState<ExtractionResponse | null>(
    () => initialExtraction ?? null,
  )
  // For salary-transfer: whether to also save IBAN to the employee record on apply.
  const [saveIbanToEmployee, setSaveIbanToEmployee] = useState(false)

  // When a sick-leave extraction is injected, auto-set leave_type so the scan
  // panel becomes visible (isSickLeave gate requires leave_type === 'Sick Leave').
  //
  // Render-order dependency (don't break this): on first render leave_type is
  // empty, so `isSickLeave` is false, `scanConfig` is null, and the seeded scan
  // panel is hidden. This mount effect sets leave_type = 'Sick Leave', which
  // flips `isSickLeave` true on the next render so `scanConfig` becomes non-null
  // and the panel — pre-seeded with `initialExtraction` — finally renders. The
  // panel is therefore intentionally absent on the very first paint.
  useEffect(() => {
    if (!initialExtraction) return
    onExtractionConsumed?.()
    if (initialExtraction.document_type === 'sick_leave') {
      const hasLeaveType = schema.fields.some((f) => f.id === 'leave_type')
      if (hasLeaveType) {
        const current = form.getValues('leave_type') as string | undefined
        if (!current) {
          form.setValue('leave_type', 'Sick Leave', { shouldDirty: false })
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Determine whether this template supports scan-to-fill and which fieldMap to use.
  // Salary Transfer Request: IBAN field id is 'iban'.
  const isSalaryTransfer = templateId === 'Salary Transfer Request'

  // Sick leave: Leave Application Form with leave_type === 'Sick Leave'.
  const hasLeaveTypeField = schema.fields.some((f) => f.id === 'leave_type')
  const watchedLeaveType: string | undefined = hasLeaveTypeField
    ? (form.watch('leave_type') as string | undefined)
    : undefined
  const isSickLeave =
    hasLeaveTypeField &&
    typeof watchedLeaveType === 'string' &&
    watchedLeaveType.toLowerCase().includes('sick')

  type ScanConfig = { expectedType: string; fieldMap: Record<string, string> } | null
  const scanConfig: ScanConfig = isSalaryTransfer
    ? {
        expectedType: 'bank_iban',
        fieldMap: {
          iban: 'iban',
          account_number: 'account_number',
          bank_name: 'bank_name',
          branch: 'branch',
        },
      }
    : isSickLeave
      ? {
          expectedType: 'sick_leave',
          fieldMap: {
            leave_from: 'start_date',
            leave_to: 'end_date',
            leave_days: 'total_days',
          },
        }
      : null

  function handleAccept(accepted: Record<string, string>): void {
    for (const [field, value] of Object.entries(accepted)) {
      form.setValue(field, value, { shouldDirty: true, shouldValidate: true })
    }
    // Salary transfer: optionally persist IBAN to the employee record.
    if (isSalaryTransfer && saveIbanToEmployee && employeeId && accepted['iban']) {
      ;(async () => {
        try {
          await api.updateEmployee(employeeId, { iban: accepted['iban'] })
          toast.success(t('extraction.salaryTransfer.ibanSaved'))
        } catch {
          toast.error(t('extraction.salaryTransfer.ibanSaveError'))
        }
      })()
    }
    setExtractionResult(null)
    setSaveIbanToEmployee(false)
  }

  // Group fields by their `group` attribute.
  // Ungrouped fields land in a synthetic "_default" bucket, rendered first.
  const groups = new Map<string, TemplateField[]>()
  for (const field of schema.fields) {
    const groupKey = field.group ?? '_default'
    const existing = groups.get(groupKey)
    if (existing) {
      existing.push(field)
    } else {
      groups.set(groupKey, [field])
    }
  }

  return (
    <FormProvider {...form}>
      <LeaveDateMathBridge fields={schema.fields} />

      {/* Scan-to-fill — only rendered for salary-transfer and sick-leave templates */}
      {scanConfig && (
        <div className="mb-4 space-y-3">
          <ExtractionDropzone
            expectedType={scanConfig.expectedType}
            onExtracted={setExtractionResult}
          />
          {extractionResult && (
            <>
              <ExtractionReviewPanel
                result={extractionResult}
                fieldMap={scanConfig.fieldMap}
                onAccept={handleAccept}
                onDismiss={() => {
                  setExtractionResult(null)
                  setSaveIbanToEmployee(false)
                }}
              />
              {/* Save IBAN to employee record — salary transfer only, employees.edit gated */}
              {isSalaryTransfer && employeeId && (
                <CapabilityGate cap="employees.edit">
                  <label className="flex cursor-pointer items-center gap-2 text-[0.82em] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={saveIbanToEmployee}
                      onChange={(e) => setSaveIbanToEmployee(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-border accent-primary"
                    />
                    {t('extraction.salaryTransfer.saveIbanToEmployee')}
                  </label>
                </CapabilityGate>
              )}
            </>
          )}
        </div>
      )}

      <div className="space-y-6">
        {Array.from(groups.entries()).map(([groupKey, groupFields]) => {
          if (groupKey === '_default') {
            return (
              <div key="_default" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {groupFields.map((f) => renderField(f, schema.fields, employeeId, templateId))}
              </div>
            )
          }

          const groupLabel = t(`application.groups.${groupKey}`, { defaultValue: groupKey })

          return (
            <fieldset key={groupKey} className="rounded-md border border-border p-4">
              <legend className="px-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {groupLabel}
              </legend>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {groupFields.map((f) => renderField(f, schema.fields, employeeId, templateId))}
              </div>
            </fieldset>
          )
        })}
      </div>
    </FormProvider>
  )
}

/**
 * Tiny inner component so `useLeaveDateMath` can call `useFormContext()`
 * from inside the FormProvider tree. Renders nothing.
 */
function LeaveDateMathBridge({ fields }: { fields: TemplateField[] }): null {
  useLeaveDateMath(fields)
  return null
}
