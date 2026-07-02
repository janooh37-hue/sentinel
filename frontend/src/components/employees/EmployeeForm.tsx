/**
 * Profile editor.
 *
 * Three section cards (Identity · Employment · Contact) instead of a flat
 * field grid. Mirrors how Workday and Oracle HCM segment person records —
 * grouping reduces visual noise on a 20+ field form.
 *
 * Validation:
 *   * Client-side: Zod (see ./schema.ts) — handles the status/end-date
 *     invariant immediately.
 *   * Server-side: FastAPI route runs the same merge validator against the
 *     stored row, so out-of-band edits (PATCH that flips status without
 *     touching end_date) still get caught.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

import {
  EMPLOYEE_STATUSES,
  employeeFormSchema,
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

export function EmployeeForm({
  mode,
  initial,
  initialExtraction,
  onSubmit,
  onCancel,
  submitting = false,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const form = useForm<EmployeeFormValues, unknown, EmployeeFormOutput>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: initial ? fromInitial(initial) : blankDefaults(),
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
  const endDateRequired = status !== 'Active'

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
    for (const [field, value] of Object.entries(accepted)) {
      setValue(field as keyof EmployeeFormValues, value, {
        shouldDirty: true,
        shouldValidate: true,
      })
    }
    setExtractionResult(null)
  }

  return (
    <form
      onSubmit={handleSubmit(async (vals) => {
        await onSubmit(vals)
      })}
      className="space-y-4 pb-20"
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

      <Card>
        <CardHeader>
          <CardTitle>{t('employees.sections.identity')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="id" label={fld('id')} error={errFor('id')}>
            <Input
              id="id"
              {...register('id')}
              disabled={mode === 'edit'}
              placeholder="G0000"
              className="font-mono"
            />
          </Field>
          <Field id="status" label={fld('status')} error={errFor('status')}>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('employees.sections.employment')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            label={`${fld('end_date')}${endDateRequired ? ' *' : ''}`}
            error={errFor('end_date')}
          >
            <Input
              id="end_date"
              type="date"
              {...register('end_date')}
              className="font-mono"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('employees.sections.contact')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                <Select value={field.value} onValueChange={field.onChange}>
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
          <Field id="notes" label={fld('notes')} className="sm:col-span-2">
            <Textarea id="notes" {...register('notes')} rows={3} />
          </Field>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 -mx-6 flex items-center justify-end gap-2 border-t border-border bg-background/85 px-6 py-3 backdrop-blur-md">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
            {t('common.cancel')}
          </Button>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </form>
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
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
