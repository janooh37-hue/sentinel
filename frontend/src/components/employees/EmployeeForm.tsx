/**
 * Profile editor.
 *
 * Identity, employment and contact columns share one document-like surface.
 * Edits are reviewed against the stored record before confirmation.
 *
 * Validation:
 *   * Client-side: Zod (see ./schema.ts) — handles the status/end-date
 *     invariant immediately.
 *   * Server-side: FastAPI route runs the same merge validator against the
 *     stored row, so out-of-band edits (PATCH that flips status without
 *     touching end_date) still get caught.
 */

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { EmployeeRead } from '@/lib/api'
import { ExtractionDropzone } from '@/components/extraction/ExtractionDropzone'
import { ExtractionReviewPanel } from '@/components/extraction/ExtractionReviewPanel'
import type { ExtractionResponse } from '@/lib/extraction'
import { pickEmployeeName } from '@/lib/employeeName'
import { formatDmy } from '@/lib/formatDmy'

import {
  EMPLOYEE_STATUSES,
  employeeFormSchema,
  isWorkingStatus,
  type EmployeeFormOutput,
  type EmployeeFormValues,
} from './schema'

export function DuplicateGuardBanner({
  result,
  language,
}: {
  result: ExtractionResponse
  language: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!result.matched_employee_id || result.match_score < 0.85) return null
  const name = pickEmployeeName(
    {
      name_en: result.matched_employee_name_en ?? result.matched_employee_id,
      name_ar: result.matched_employee_name_ar,
    },
    language,
  )
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-foreground"
    >
      <AlertTriangle aria-hidden strokeWidth={1.75} className="h-4 w-4 shrink-0 text-warning" />
      <span className="font-medium">{t('extraction.duplicateGuard.title')}</span>
      <span className="text-muted-foreground">
        {t('extraction.duplicateGuard.body', {
          name,
          id: result.matched_employee_id,
          pct: Math.round(result.match_score * 100),
        })}
      </span>
      <Link
        to={`/employees/${encodeURIComponent(result.matched_employee_id)}`}
        className="ms-auto font-medium text-primary underline-offset-2 hover:underline"
      >
        {t('extraction.duplicateGuard.openRecord')}
      </Link>
    </div>
  )
}

interface Props {
  mode: 'create' | 'edit'
  initial?: Partial<EmployeeRead>
  /** Pre-seed the scan panel from an injected extraction (intake flow). */
  initialExtraction?: ExtractionResponse
  onSubmit: (values: EmployeeFormOutput) => Promise<void> | void
  onCancel?: () => void
  submitting?: boolean
  /** Notified whenever the form starts or stops differing from `initial`. */
  onChangesChange?: (hasChanges: boolean) => void
}

function todayIso(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function blankDefaults(): EmployeeFormValues {
  return {
    id: '',
    name_en: '',
    name_ar: '',
    dob: '',
    doj: '',
    doj_company: '',
    status: 'Active',
    end_date: '',
    transfer_site: '',
    transfer_return_date: '',
    effective_date: todayIso(),
    department: '',
    position: '',
    position_ar: '',
    other: '',
    notes: '',
    passport_no: '',
    uae_id_no: '',
    nationality: '',
    contact: '',
    msg_language: 'ar',
    passport_expiry: '',
    uae_id_expiry: '',
  }
}

function fromInitial(initial: Partial<EmployeeRead>): EmployeeFormValues {
  const base = blankDefaults()
  return {
    ...base,
    id: initial.id ?? '',
    name_en: initial.name_en ?? '',
    name_ar: initial.name_ar ?? '',
    dob: initial.dob ?? '',
    doj: initial.doj ?? '',
    doj_company: initial.doj_company ?? '',
    status: initial.status ?? 'Active',
    end_date: initial.end_date ?? '',
    transfer_site: initial.transfer_site ?? '',
    transfer_return_date: initial.transfer_return_date ?? '',
    effective_date: todayIso(),
    department: initial.department ?? '',
    position: initial.position ?? '',
    position_ar: initial.position_ar ?? '',
    other: initial.other ?? '',
    notes: initial.notes ?? '',
    passport_no: initial.passport_no ?? '',
    uae_id_no: initial.uae_id_no ?? '',
    nationality: initial.nationality ?? '',
    contact: initial.contact ?? '',
    msg_language: (initial.msg_language as 'ar' | 'en' | undefined) ?? 'ar',
    passport_expiry: initial.passport_expiry ?? '',
    uae_id_expiry: initial.uae_id_expiry ?? '',
  }
}

type FieldName = keyof EmployeeFormValues
const ChangeContext = createContext<((id: string) => React.ReactNode) | null>(null)

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function EmployeeForm({
  mode,
  initial,
  initialExtraction,
  onSubmit,
  onCancel,
  submitting = false,
  onChangesChange,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [defaults] = useState(() => initial ? fromInitial(initial) : blankDefaults())
  const [review, setReview] = useState<EmployeeFormOutput | null>(null)
  const reviewHeading = useRef<HTMLHeadingElement>(null)
  const saveButton = useRef<HTMLButtonElement>(null)
  const form = useForm<EmployeeFormValues, unknown, EmployeeFormOutput>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: defaults,
    mode: 'onBlur',
  })
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = form

  const status = watch('status')
  const endDateRequired = !isWorkingStatus(status)
  const isTransferred = status === 'Transferred'
  // Reactivating a departed/transferred employee (to Active or Loaned) asks for the return date.
  const isReactivation =
    mode === 'edit' && initial?.status != null && !isWorkingStatus(initial.status) && isWorkingStatus(status)

  const values = watch()
  const changedFields = (Object.keys(defaults) as FieldName[]).filter((key) =>
    (key !== 'effective_date' || isReactivation) &&
    (key !== 'transfer_site' && key !== 'transfer_return_date' || isTransferred) &&
    normalized(values[key]) !== normalized(defaults[key]),
  )
  const hasChanges = changedFields.length > 0
  useEffect(() => { onChangesChange?.(hasChanges) }, [hasChanges, onChangesChange])

  function shape(vals: EmployeeFormOutput): EmployeeFormOutput {
    // Pending transfers must retain their destination when saving a working employee.
    const keepPendingTransfer =
      isWorkingStatus(vals.status) && initial?.pending_status === 'Transferred'
    return {
      ...vals,
      transfer_site: vals.status === 'Transferred' ? vals.transfer_site :
        keepPendingTransfer ? (initial?.transfer_site ?? null) : null,
      transfer_return_date: vals.status === 'Transferred' ? vals.transfer_return_date :
        keepPendingTransfer ? (initial?.transfer_return_date ?? null) : null,
      effective_date: mode === 'edit' && initial?.status != null &&
        !isWorkingStatus(initial.status) && isWorkingStatus(vals.status)
        ? vals.effective_date : null,
    }
  }

  function shown(key: string, value: unknown): string {
    const text = normalized(value)
    if (!text) return t('employees.editForm.empty')
    if (key === 'status') return t(`employees.status.${text}`)
    if (key === 'msg_language') return fld(text === 'ar' ? 'msgLanguageAr' : 'msgLanguageEn')
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return formatDmy(text)
    return text
  }

  function fieldLabel(key: string): string {
    if (key === 'effective_date') return fld('return_date')
    if (key === 'end_date' && (review?.status ?? status) === 'Transferred') return fld('effective_date')
    return fld(key)
  }

  function changeNote(id: string): React.ReactNode {
    const key = id as FieldName
    if (mode !== 'edit' || !changedFields.includes(key)) return null
    return (
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>{t('employees.editForm.was')} <bdi dir="auto">{shown(key, key === 'effective_date' ? null : defaults[key])}</bdi></span>
        <span aria-hidden>·</span>
        <Button type="button" variant="link" className="min-h-[44px] min-w-[44px] px-1 text-xs text-primary-text"
          aria-label={t('employees.editForm.undoField', { field: fieldLabel(key) })}
          disabled={submitting}
          onClick={() => {
            setValue(key, defaults[key], { shouldDirty: true, shouldValidate: true })
            setReview(null)
          }}>
          {t('employees.editForm.undo')}
        </Button>
      </div>
    )
  }

  const reviewFields = review ? (Object.keys(review) as FieldName[]).filter((key) =>
    normalized(review[key]) !== normalized(key === 'effective_date' ? null : defaults[key]),
  ) : []

  const confirmSave = handleSubmit(async (vals) => {
    if (!review || !hasChanges || submitting) return
    const submitted = shape(vals)
    // A programmatic/extraction change must be reviewed too, never silently submitted.
    if (JSON.stringify(submitted) !== JSON.stringify(review)) {
      setReview(submitted)
      return
    }
    await onSubmit(submitted)
  }, () => setReview(null))
  // Seed the extraction panel from an injected extraction (intake flow).
  const [extractionResult, setExtractionResult] = useState<ExtractionResponse | null>(
    () => initialExtraction ?? null,
  )

  const fld = (k: string): string => t(`employees.fields.${k}`)
  const errFor = (path: string): string | undefined => {
    const node = (errors as Record<string, { message?: string }>)[path]
    if (!node?.message) return undefined
    return t(`employees.validation.${node.message}`, { defaultValue: node.message })
  }

  // Compute the expiry target field based on the extracted document type.
  const expiryTarget =
    extractionResult?.document_type === 'passport'
      ? 'passport_expiry'
      : extractionResult?.document_type === 'emirates_id'
        ? 'uae_id_expiry'
        : undefined

  // Base field map for EmployeeForm — expiry resolves dynamically via expiryTarget.
  const baseFieldMap: Record<string, string> = {
    name_en: 'name_en',
    name_ar: 'name_ar',
    nationality: 'nationality',
    dob: 'dob',
    uae_id_no: 'uae_id_no',
    passport_no: 'passport_no',
  }
  const fieldMap: Record<string, string> = expiryTarget
    ? { ...baseFieldMap, expiry: expiryTarget }
    : baseFieldMap

  function handleAccept(accepted: Record<string, string>): void {
    setReview(null)
    for (const [field, value] of Object.entries(accepted)) {
      setValue(field as keyof EmployeeFormValues, value, {
        shouldDirty: true,
        shouldValidate: true,
      })
    }
    setExtractionResult(null)
  }

  return (
    <ChangeContext.Provider value={changeNote}>
    <form
      onChangeCapture={() => setReview(null)}
      onSubmit={handleSubmit(async (vals) => {
        if (submitting) return
        const submitted = shape(vals)
        if (mode === 'create') {
          await onSubmit(submitted)
        } else if (hasChanges) {
          setReview(submitted)
          requestAnimationFrame(() => reviewHeading.current?.focus())
        }
      })}
      className="@container space-y-4 pb-6 [&_input]:min-h-[44px] [&_textarea]:min-h-[88px] [&_[role=combobox]]:min-h-[44px]"
      aria-label={t(`employees.${mode === 'create' ? 'newEmployee' : 'tabs.profile'}`)}
    >
      {/* Scan-to-fill dropzone — above the Identity card */}
      <ExtractionDropzone onExtracted={setExtractionResult} />
      {extractionResult && (
        <ExtractionReviewPanel
          result={extractionResult}
          fieldMap={fieldMap}
          onAccept={handleAccept}
          onDismiss={() => setExtractionResult(null)}
        />
      )}
      {mode === 'create' && extractionResult && (
        <DuplicateGuardBanner result={extractionResult} language={i18n.language} />
      )}

      <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-border bg-surface @min-[1000px]:grid-cols-3">
      <section aria-labelledby="employee-identity-heading" className="min-w-0 p-5 @min-[1000px]:p-6">
        <h2 id="employee-identity-heading" className="mb-5 text-lg font-bold">{t('employees.sections.identity')}</h2>
        <div className="grid grid-cols-1 gap-4">
          {mode === 'create' && (
            <Field id="id" label={fld('id')} error={errFor('id')}>
              <Input id="id" {...register('id')} placeholder="G0000" className="font-mono" />
            </Field>
          )}
          <Field id="name_en" label={fld('name_en')} error={errFor('name_en')}>
            <Input id="name_en" {...register('name_en')} />
          </Field>
          <Field id="name_ar" label={fld('name_ar')} error={errFor('name_ar')}>
            <Input id="name_ar" dir="rtl" {...register('name_ar')} />
          </Field>
          <Field id="nationality" label={fld('nationality')}>
            <Input id="nationality" {...register('nationality')} />
          </Field>
          <Field id="dob" label={fld('dob')}>
            <Input id="dob" type="date" {...register('dob')} className="font-mono" />
          </Field>
        </div>
      </section>

      <section aria-labelledby="employee-employment-heading" className="min-w-0 border-t border-border p-5 @min-[1000px]:border-t-0 @min-[1000px]:border-s @min-[1000px]:p-6">
        <h2 id="employee-employment-heading" className="mb-5 text-lg font-bold">{t('employees.sections.employment')}</h2>
        <div className="grid grid-cols-1 gap-4">
          <Field id="status" label={fld('status')} error={errFor('status')}>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select value={field.value} onValueChange={(value) => { field.onChange(value); setReview(null) }}>
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMPLOYEE_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`employees.status.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field id="department" label={fld('department')}>
            <Input id="department" {...register('department')} />
          </Field>
          <Field id="position" label={fld('position')}>
            <Input id="position" {...register('position')} />
          </Field>
          <Field id="position_ar" label={fld('position_ar')}>
            <Input id="position_ar" dir="rtl" {...register('position_ar')} />
          </Field>
          <Field id="doj" label={fld('doj')}>
            <Input id="doj" type="date" {...register('doj')} className="font-mono" />
          </Field>
          <Field id="doj_company" label={fld('doj_company')}>
            <Input
              id="doj_company"
              type="date"
              {...register('doj_company')}
              className="font-mono"
            />
          </Field>
          <Field
            id="end_date"
            label={`${fld(isTransferred ? 'effective_date' : 'end_date')}${endDateRequired ? ' *' : ''}`}
            error={errFor('end_date')}
          >
            <Input
              id="end_date"
              type="date"
              {...register('end_date')}
              className="font-mono"
            />
          </Field>
          {isTransferred && (
            <>
              <Field
                id="transfer_site"
                label={`${fld('transfer_site')} *`}
                error={errFor('transfer_site')}
              >
                <Input id="transfer_site" dir="auto" maxLength={128} {...register('transfer_site')} />
              </Field>
              <Field
                id="transfer_return_date"
                label={fld('transfer_return_date')}
                error={errFor('transfer_return_date')}
              >
                <Input
                  id="transfer_return_date"
                  type="date"
                  {...register('transfer_return_date')}
                  className="font-mono"
                />
              </Field>
            </>
          )}
          {isReactivation && (
            <Field id="effective_date" label={fld('return_date')}>
              <Input
                id="effective_date"
                type="date"
                {...register('effective_date')}
                className="font-mono"
              />
            </Field>
          )}
        </div>
      </section>

      <section aria-labelledby="employee-contact-heading" className="min-w-0 border-t border-border p-5 @min-[1000px]:border-t-0 @min-[1000px]:border-s @min-[1000px]:p-6">
        <h2 id="employee-contact-heading" className="mb-5 text-lg font-bold">{t('employees.sections.contact')}</h2>
        <div className="grid grid-cols-1 gap-4">
          <Field id="passport_no" label={fld('passport_no')}>
            <Input id="passport_no" {...register('passport_no')} className="font-mono" />
          </Field>
          <Field id="passport_expiry" label={fld('passport_expiry')}>
            <Input
              id="passport_expiry"
              type="date"
              {...register('passport_expiry')}
              className="font-mono"
            />
          </Field>
          <Field id="uae_id_no" label={fld('uae_id_no')}>
            <Input id="uae_id_no" {...register('uae_id_no')} className="font-mono" />
          </Field>
          <Field id="uae_id_expiry" label={fld('uae_id_expiry')}>
            <Input
              id="uae_id_expiry"
              type="date"
              {...register('uae_id_expiry')}
              className="font-mono"
            />
          </Field>
          <Field id="contact" label={fld('contact')}>
            <Input id="contact" {...register('contact')} className="font-mono" />
          </Field>
          {/* Preferred WhatsApp message language */}
          <Field id="msg_language" label={fld('msg_language')}>
            <Controller
              control={control}
              name="msg_language"
              render={({ field }) => (
                <Select value={field.value} onValueChange={(value) => { field.onChange(value); setReview(null) }}>
                  <SelectTrigger id="msg_language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ar">{t('employees.fields.msgLanguageAr')}</SelectItem>
                    <SelectItem value="en">{t('employees.fields.msgLanguageEn')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field id="other" label={fld('other')}>
            <Input id="other" {...register('other')} />
          </Field>
        </div>
      </section>
      <div className="col-span-full border-t border-border p-5 @min-[1000px]:p-6">
        <Field id="notes" label={fld('notes')}>
          <Textarea id="notes" {...register('notes')} rows={3} />
        </Field>
      </div>
      </div>

      <div className={`sticky bottom-0 z-20 border-t bg-surface px-4 py-4 ${review ? 'border-t-2 border-primary shadow-lg' : 'border-border'}`}>
        {review ? (
          <section aria-labelledby="employee-review-heading">
            <h3 id="employee-review-heading" ref={reviewHeading} tabIndex={-1} className="mb-3 text-lg font-bold">
              {t('employees.editForm.review')}
            </h3>
            <div className="max-h-[35dvh] overflow-auto">
              <table className="w-full table-fixed text-start text-sm">
                <thead>
                  <tr className="text-muted-foreground">
                    <th scope="col" className="px-2 py-2 text-start font-semibold">{t('employees.editForm.field')}</th>
                    <th scope="col" className="px-2 py-2 text-start font-semibold">{t('employees.editForm.before')}</th>
                    <th scope="col" className="px-2 py-2 text-start font-semibold">{t('employees.editForm.after')}</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewFields.map((key) => (
                    <tr key={key} className="border-t border-hairline align-top [overflow-wrap:anywhere]">
                      <th scope="row" className="px-2 py-2 text-start font-medium">{fieldLabel(key)}</th>
                      <td className="whitespace-pre-wrap px-2 py-2 text-muted-foreground line-through"><bdi dir="auto">{shown(key, key === 'effective_date' ? null : defaults[key])}</bdi></td>
                      <td className="whitespace-pre-wrap px-2 py-2 font-semibold"><bdi dir="auto">{shown(key, review[key])}</bdi></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" className="min-h-[44px] whitespace-normal" disabled={submitting}
                onClick={() => { setReview(null); requestAnimationFrame(() => saveButton.current?.focus()) }}>
                {t('employees.editForm.keepEditing')}
              </Button>
              <Button type="button" className="min-h-[44px] whitespace-normal" disabled={submitting} onClick={() => void confirmSave()}>
                {submitting ? t('common.loading') : t('employees.editForm.confirmSave')}
              </Button>
            </div>
          </section>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {mode === 'edit' && <p role="status" className="me-auto text-sm text-muted-foreground">{hasChanges ? t('employees.editForm.changed', { count: changedFields.length }) : t('employees.editForm.unchanged')}</p>}
            {onCancel && (
              <Button type="button" variant="secondary" className="min-h-[44px]" onClick={onCancel} disabled={submitting}>
                {t('common.cancel')}
              </Button>
            )}
            <Button ref={saveButton} type="submit" className="min-h-[44px]" disabled={submitting || mode === 'edit' && !hasChanges}>
              {submitting ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        )}
      </div>
    </form>
    </ChangeContext.Provider>
  )
}

function Field({
  id,
  label,
  error,
  className,
  children,
}: {
  id: string
  label: string
  error?: string
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  const changeNote = useContext(ChangeContext)
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <Label htmlFor={id} className="text-[0.86rem] font-bold normal-case tracking-normal text-foreground">{label}</Label>
      {children}
      {changeNote?.(id)}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
