/**
 * Profile tab — four section cards (personal / identity / work / finance) with
 * actionable missing-field rows → Identity documents (ID + passport tiles)
 * → Signature pad. Photo upload lives on the hero (top), not here.
 */

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight } from 'lucide-react'
import { differenceInDays, parseISO } from 'date-fns'
import { toast } from 'sonner'

import { IdentityDocCard } from '@/components/employees/IdentityDocCard'
import { SignaturePad } from '@/components/employees/SignaturePad'
import { PassportField } from './PassportField'
import { api, apiErrorMessage } from '@/lib/api'
import type { EmployeeRead, EmployeeUpdate } from '@/lib/api'
import { pickPosition } from '@/lib/employeePosition'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { TransferEmployeeDialog } from '../TransferEmployeeDialog'

// ── Module-level constants ───────────────────────────────────────────────────

// Fields that should render in a monospace font (dates, IDs, financial codes).
const MONO_FIELDS = new Set([
  'dob',
  'doj',
  'doj_company',
  'uae_id_no',
  'uae_id_expiry',
  'passport_no',
  'passport_expiry',
  'iban',
  'contact',
])

// Feminine field labels (use notSetF instead of notSet).
const FEMININE_FIELDS = new Set(['nationality'])

// Fields edited with a date input in the inline gap editor.
const DATE_FIELDS = new Set(['dob', 'uae_id_expiry', 'passport_expiry', 'doj'])

// Tracked fields per section — these are the fields that may appear in `missing`.
const PERSONAL_TRACKED = ['name_ar', 'name_en', 'nationality', 'dob', 'contact']
const IDENTITY_TRACKED = ['uae_id_no', 'uae_id_expiry', 'passport_no', 'passport_expiry']
const WORK_TRACKED = ['position', 'department', 'duty_unit', 'doj']
const FINANCE_TRACKED = ['iban']

// Returns days remaining until expiry if within [0, 90] days, otherwise null.
function nearExpiryDays(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const days = differenceInDays(parseISO(dateStr), new Date())
  return days >= 0 && days <= 90 ? days : null
}

// Pure helper — computes display value for a field (no missing-row logic).
function getFieldValue(
  field: string,
  employee: EmployeeRead,
  uaeExpiryDays: number | null,
  t: (k: string, options?: Record<string, unknown>) => string,
  language: string,
): React.ReactNode {
  switch (field) {
    case 'name_ar':
      return employee.name_ar
    case 'name_en':
      return employee.name_en
    case 'nationality':
      return employee.nationality
    case 'dob':
      return employee.dob
    case 'contact':
      return employee.contact
    case 'msg_language': {
      const lang = employee.msg_language
      if (!lang) return null
      return lang === 'ar'
        ? t('employees.fields.msgLanguageAr')
        : t('employees.fields.msgLanguageEn')
    }
    case 'uae_id_no':
      return employee.uae_id_no
    case 'uae_id_expiry': {
      const val = employee.uae_id_expiry
      if (!val) return null
      return (
        <>
          {val}
          {uaeExpiryDays !== null && (
            <span className="ms-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[0.65em] font-bold text-amber-700">
              {'⚠ '}
              {t('employees.lookup.daysLeft', { count: uaeExpiryDays })}
            </span>
          )}
        </>
      )
    }
    case 'passport_no':
      return employee.passport_no
    case 'passport_expiry':
      return employee.passport_expiry
    case 'position':
      return pickPosition(employee, language)
    case 'department':
      return employee.department
    case 'duty_unit':
      return employee.duty_unit
    case 'duty_post':
      return employee.duty_post
    case 'doj':
      return employee.doj
    case 'doj_company':
      return employee.doj_company
    case 'iban':
      return employee.iban
    default:
      return null
  }
}

// ── Sub-components (module level — avoids react-hooks/static-components) ────

interface InlineFieldEditorProps {
  employeeId: string
  field: string
  onDone: () => void
}

/** In-place editor for a single missing field — type-aware input (date fields
 *  get a date picker), single-field PATCH, Escape/cancel to close. */
function InlineFieldEditor({ employeeId, field, onDone }: InlineFieldEditorProps): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const isDate = DATE_FIELDS.has(field)
  const isMono = MONO_FIELDS.has(field)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const save = useMutation({
    mutationFn: () =>
      api.updateEmployee(employeeId, { [field]: value.trim() } as EmployeeUpdate),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employee-detail', employeeId] })
      void qc.invalidateQueries({ queryKey: ['employees'] })
      toast.success(t('employees.toast.updated'))
      onDone()
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err))
    },
  })

  const canSave = value.trim().length > 0 && !save.isPending

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSave) save.mutate()
      }}
    >
      <input
        ref={inputRef}
        type={isDate ? 'date' : 'text'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone()
        }}
        dir={isDate || isMono ? 'ltr' : undefined}
        className="h-8 min-w-0 flex-1 basis-36 rounded-md border border-amber-300 bg-surface px-2 text-start text-[0.9em] text-foreground outline-none focus:ring-2 focus:ring-amber-400"
        aria-label={t(`employee.field.${field}`)}
      />
      <button
        type="submit"
        disabled={!canSave}
        className="rounded-md bg-primary px-2.5 py-1 text-[0.78em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {t('common.save')}
      </button>
      <button
        type="button"
        onClick={onDone}
        className="rounded-md px-2 py-1 text-[0.78em] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {t('common.cancel')}
      </button>
    </form>
  )
}

interface FieldRowProps {
  field: string
  employee: EmployeeRead
  missingSet: Set<string>
  uaeExpiryDays: number | null
  canEdit: boolean
  fixingField: string | null
  onStartFix: (field: string) => void
  onDoneFix: () => void
}

function FieldRow({
  field,
  employee,
  missingSet,
  uaeExpiryDays,
  canEdit,
  fixingField,
  onStartFix,
  onDoneFix,
}: FieldRowProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isMiss = missingSet.has(field)
  const isMono = MONO_FIELDS.has(field)
  const isFeminine = FEMININE_FIELDS.has(field)
  const isFixing = isMiss && fixingField === field
  const val = getFieldValue(field, employee, uaeExpiryDays, t, i18n.language)

  return (
    <div
      data-field-row={field}
      className={cn(
        'grid grid-cols-[120px_1fr] items-baseline gap-3 border-b border-hairline pb-3 pt-3 sm:grid-cols-[140px_1fr]',
        isMiss && 'rounded-md bg-gradient-to-l from-transparent to-amber-50/60 rtl:bg-gradient-to-r',
      )}
    >
      <div className="shrink-0 text-[0.78em] font-semibold uppercase tracking-wider text-muted-foreground">
        {t(`employee.field.${field}`)}
      </div>
      <div
        className={cn(
          'min-w-0 break-words text-[0.95em] text-foreground',
          isMono && !isFixing && 'font-mono text-[0.88em] text-start',
        )}
        dir={isMono && !isFixing ? 'ltr' : undefined}
      >
        {isFixing ? (
          <InlineFieldEditor employeeId={employee.id} field={field} onDone={onDoneFix} />
        ) : isMiss ? (
          <span className="flex items-center gap-2.5">
            <span className="text-[0.88em] font-semibold text-amber-600">
              {isFeminine ? t('employee.gaps.notSetF') : t('employee.gaps.notSet')}
            </span>
            {canEdit && (
              <button
                type="button"
                className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[0.75em] font-semibold text-amber-700 transition-colors hover:bg-amber-500/20"
                onClick={() => onStartFix(field)}
              >
                {t('employee.gaps.addNow')}
              </button>
            )}
          </span>
        ) : (
          val ?? <span className="text-faint">—</span>
        )}
      </div>
    </div>
  )
}

interface SectionCardProps {
  sectionKey: string
  trackedFields: string[]
  fields: string[]
  employee: EmployeeRead
  missingSet: Set<string>
  uaeExpiryDays: number | null
  canEdit: boolean
  fixingField: string | null
  onStartFix: (field: string) => void
  onDoneFix: () => void
  footer?: React.ReactNode
}

function SectionCard({
  sectionKey,
  trackedFields,
  fields,
  employee,
  missingSet,
  uaeExpiryDays,
  canEdit,
  fixingField,
  onStartFix,
  onDoneFix,
  footer,
}: SectionCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const missingCount = trackedFields.filter((f) => missingSet.has(f)).length

  return (
    <div className="rounded-2xl bg-surface p-4 md:p-6">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[0.78em] font-semibold uppercase tracking-wider text-muted-foreground">
          {t(`employee.section.${sectionKey}`)}
        </h3>
        {missingCount > 0 ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[0.78em] font-bold text-amber-700">
            {t('employee.gaps.sectionMissing', { count: missingCount })}
          </span>
        ) : (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[0.78em] font-bold text-emerald-700">
            {t('employee.gaps.sectionComplete')}
          </span>
        )}
      </div>
      {fields.map((field) => (
        <FieldRow
          key={field}
          field={field}
          employee={employee}
          missingSet={missingSet}
          uaeExpiryDays={uaeExpiryDays}
          canEdit={canEdit}
          fixingField={fixingField}
          onStartFix={onStartFix}
          onDoneFix={onDoneFix}
        />
      ))}
      {footer}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

interface Props {
  employee: EmployeeRead
  missing: string[]
  /** Field the sidebar gaps card asked us to open an inline editor for. */
  requestedFixField?: string | null
  /** Called once the requested field's editor has been opened. */
  onFixHandled?: () => void
}

export function ProfileTab({
  employee,
  missing,
  requestedFixField,
  onFixHandled,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const qc = useQueryClient()
  const canEdit = has('employees.edit')

  const [transferOpen, setTransferOpen] = useState(false)
  const [fixingField, setFixingField] = useState<string | null>(null)

  // Sidebar gaps-card handoff: open the inline editor for the requested field.
  // Render-time state adjustment (not an effect) per React's derived-state
  // guidance — reacts to each null→field transition of requestedFixField.
  const requested = requestedFixField ?? null
  const [lastRequested, setLastRequested] = useState<string | null>(null)
  if (requested !== lastRequested) {
    setLastRequested(requested)
    if (requested) setFixingField(requested)
  }

  // External-system half of the handoff: scroll the row into view, then tell
  // the parent the request was consumed.
  useEffect(() => {
    if (!requestedFixField) return
    document
      .querySelector(`[data-field-row="${requestedFixField}"]`)
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    onFixHandled?.()
  }, [requestedFixField, onFixHandled])

  const handleDoneFix = (): void => setFixingField(null)

  const { data: tree, isError: vaultError } = useQuery({
    queryKey: ['vault', employee.id],
    queryFn: () => api.getVault(employee.id),
  })

  const invalidateVault = (): void => {
    void qc.invalidateQueries({ queryKey: ['vault', employee.id] })
  }

  const invalidateEmployee = (): void => {
    void qc.invalidateQueries({ queryKey: ['employee-detail', employee.id] })
  }

  const missingSet = new Set(missing)
  const uaeExpiryDays = nearExpiryDays(employee.uae_id_expiry)

  const transferFooter = canEdit ? (
    <div className="mt-3 flex justify-end">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setTransferOpen(true)}
      >
        <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
        {t('employee.profile.transfer')}
      </Button>
      {transferOpen && (
        <TransferEmployeeDialog open employee={employee} onOpenChange={setTransferOpen} />
      )}
    </div>
  ) : null

  return (
    <div className="space-y-5">
      {/* ── Four section cards ─────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Personal */}
        <SectionCard
          sectionKey="personal"
          trackedFields={PERSONAL_TRACKED}
          fields={['name_ar', 'name_en', 'nationality', 'dob', 'contact', 'msg_language']}
          employee={employee}
          missingSet={missingSet}
          uaeExpiryDays={uaeExpiryDays}
          canEdit={canEdit}
          fixingField={fixingField}
          onStartFix={setFixingField}
          onDoneFix={handleDoneFix}
        />

        {/* Identity data */}
        <SectionCard
          sectionKey="identity"
          trackedFields={IDENTITY_TRACKED}
          fields={['uae_id_no', 'uae_id_expiry', 'passport_no', 'passport_expiry']}
          employee={employee}
          missingSet={missingSet}
          uaeExpiryDays={uaeExpiryDays}
          canEdit={canEdit}
          fixingField={fixingField}
          onStartFix={setFixingField}
          onDoneFix={handleDoneFix}
        />

        {/* Work */}
        <SectionCard
          sectionKey="work"
          trackedFields={WORK_TRACKED}
          fields={['position', 'department', 'duty_unit', 'duty_post', 'doj', 'doj_company']}
          employee={employee}
          missingSet={missingSet}
          uaeExpiryDays={uaeExpiryDays}
          canEdit={canEdit}
          fixingField={fixingField}
          onStartFix={setFixingField}
          onDoneFix={handleDoneFix}
          footer={transferFooter}
        />

        {/* Finance */}
        <SectionCard
          sectionKey="finance"
          trackedFields={FINANCE_TRACKED}
          fields={['iban']}
          employee={employee}
          missingSet={missingSet}
          uaeExpiryDays={uaeExpiryDays}
          canEdit={canEdit}
          fixingField={fixingField}
          onStartFix={setFixingField}
          onDoneFix={handleDoneFix}
        />
      </div>

      {/* ── Identity documents (scan tiles + PassportField) ────────────────── */}
      <section className="space-y-3">
        <h3 className="text-[0.92em] font-semibold">{t('employee.identity.title')}</h3>
        {vaultError ? (
          <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
            {t('common.loadError')}
          </div>
        ) : (
          tree && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <IdentityDocCard
                  employeeId={employee.id}
                  kind="uae_id"
                  docNumber={employee.uae_id_no ?? null}
                  entry={tree.folders.uae_id?.[0] ?? null}
                  canEdit={canEdit}
                  onChanged={invalidateVault}
                />
                <IdentityDocCard
                  employeeId={employee.id}
                  kind="passport"
                  docNumber={employee.passport_no ?? null}
                  entry={tree.folders.passport?.[0] ?? null}
                  canEdit={canEdit}
                  onChanged={invalidateVault}
                />
              </div>
              {/* Passport OCR field — badge + editable number + Read from scan */}
              <PassportField
                employeeId={employee.id}
                passportNo={employee.passport_no ?? null}
                source={employee.passport_no_source ?? null}
                hasScan={employee.has_passport_scan}
                canEdit={canEdit}
                onSaved={invalidateEmployee}
              />
            </>
          )
        )}
      </section>

      {/* ── Signature (bottom) ─────────────────────────────────────────────── */}
      <SignaturePad employeeId={employee.id} canEdit={canEdit} />
    </div>
  )
}
