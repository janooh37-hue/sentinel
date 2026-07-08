/**
 * Profile tab — four section cards (personal / identity / work / finance) with
 * actionable missing-field rows → Identity documents (ID + passport tiles)
 * → Signature pad. Photo upload lives on the hero (top), not here.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight } from 'lucide-react'
import { differenceInDays, parseISO } from 'date-fns'

import { IdentityDocCard } from '@/components/employees/IdentityDocCard'
import { SignaturePad } from '@/components/employees/SignaturePad'
import { PassportField } from './PassportField'
import { api } from '@/lib/api'
import type { EmployeeRead } from '@/lib/api'
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

interface FieldRowProps {
  field: string
  employee: EmployeeRead
  missingSet: Set<string>
  uaeExpiryDays: number | null
  onFix: (field: string) => void
}

function FieldRow({
  field,
  employee,
  missingSet,
  uaeExpiryDays,
  onFix,
}: FieldRowProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isMiss = missingSet.has(field)
  const isMono = MONO_FIELDS.has(field)
  const isFeminine = FEMININE_FIELDS.has(field)
  const val = getFieldValue(field, employee, uaeExpiryDays, t, i18n.language)

  return (
    <div
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
          isMono && 'font-mono text-[0.88em] text-start',
        )}
        dir={isMono ? 'ltr' : undefined}
      >
        {isMiss ? (
          <span className="flex items-center gap-2.5">
            <span className="text-[0.88em] font-semibold text-amber-600">
              {isFeminine ? t('employee.gaps.notSetF') : t('employee.gaps.notSet')}
            </span>
            <button
              type="button"
              className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[0.75em] font-semibold text-amber-700 transition-colors hover:bg-amber-500/20"
              onClick={() => onFix(field)}
            >
              {t('employee.gaps.addNow')}
            </button>
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
  onFix: (field: string) => void
  footer?: React.ReactNode
}

function SectionCard({
  sectionKey,
  trackedFields,
  fields,
  employee,
  missingSet,
  uaeExpiryDays,
  onFix,
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
          onFix={onFix}
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
  onFix: (field: string) => void
}

export function ProfileTab({ employee, missing, onFix }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const qc = useQueryClient()
  const canEdit = has('employees.edit')

  const [transferOpen, setTransferOpen] = useState(false)

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
          onFix={onFix}
        />

        {/* Identity data */}
        <SectionCard
          sectionKey="identity"
          trackedFields={IDENTITY_TRACKED}
          fields={['uae_id_no', 'uae_id_expiry', 'passport_no', 'passport_expiry']}
          employee={employee}
          missingSet={missingSet}
          uaeExpiryDays={uaeExpiryDays}
          onFix={onFix}
        />

        {/* Work */}
        <SectionCard
          sectionKey="work"
          trackedFields={WORK_TRACKED}
          fields={['position', 'department', 'duty_unit', 'duty_post', 'doj', 'doj_company']}
          employee={employee}
          missingSet={missingSet}
          uaeExpiryDays={uaeExpiryDays}
          onFix={onFix}
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
          onFix={onFix}
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
