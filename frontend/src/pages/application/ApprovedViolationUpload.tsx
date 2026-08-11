import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  Loader2,
  Plus,
  Trash2,
  UploadCloud,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  ApiError,
  api,
  type ApprovedViolationImportRead,
  type ApprovedViolationInspectionRead,
} from '@/lib/api'
import { cn } from '@/lib/utils'

const MAX_BYTES = 25 * 1024 * 1024
const ACCEPT = 'application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg'
const ALLOWED_TYPE: Record<string, true> = {
  'application/pdf': true,
  'image/png': true,
  'image/jpeg': true,
}
const WARNING_KEYS: Record<string, string> = {
  APPROVED_IMPORT_WARNING_OCR_UNAVAILABLE:
    'application.approvedViolation.warnings.ocrUnavailable',
  APPROVED_IMPORT_WARNING_CONFIRM_DATE: 'application.approvedViolation.warnings.confirmDate',
  APPROVED_IMPORT_WARNING_CONFIRM_NAMES: 'application.approvedViolation.warnings.confirmNames',
}
const ERROR_KEYS: Record<string, string> = {
  APPROVED_IMPORT_FILE_EMPTY: 'application.approvedViolation.errors.empty',
  APPROVED_IMPORT_FILE_TOO_LARGE: 'application.approvedViolation.errors.tooLarge',
  APPROVED_IMPORT_BAD_FILE: 'application.approvedViolation.errors.invalidFile',
  APPROVED_IMPORT_TOKEN_NOT_FOUND: 'application.approvedViolation.errors.expired',
  APPROVED_IMPORT_TOKEN_EXPIRED: 'application.approvedViolation.errors.expired',
  APPROVED_IMPORT_METADATA_REQUIRED: 'application.approvedViolation.errors.metadataRequired',
}
const ApprovedViolationPreview = lazy(() =>
  import('./ApprovedViolationPreview').then((module) => ({
    default: module.ApprovedViolationPreview,
  })),
)

interface ApprovedViolationUploadProps {
  onSaved: (result: ApprovedViolationImportRead) => void
  onSaveBusyChange?: (busy: boolean) => void
}

interface FieldErrors {
  reportDate?: string
  inmateNames?: string
  subject?: string
}


export function ApprovedViolationUpload({
  onSaved,
  onSaveBusyChange,
}: ApprovedViolationUploadProps): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dropzoneRef = useRef<HTMLDivElement | null>(null)
  const fileStatusRef = useRef<HTMLParagraphElement | null>(null)
  const dateRef = useRef<HTMLInputElement | null>(null)
  const nameRefs = useRef<Array<HTMLInputElement | null>>([])
  const subjectRef = useRef<HTMLInputElement | null>(null)
  const requestId = useRef(0)
  const commitBusyRef = useRef(false)
  const pendingNameFocusRef = useRef<number | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [inspection, setInspection] = useState<ApprovedViolationInspectionRead | null>(null)
  const [reportDate, setReportDate] = useState('')
  const [inmateNames, setInmateNames] = useState<string[]>([''])
  const [subject, setSubject] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (file) fileStatusRef.current?.focus()
    else dropzoneRef.current?.focus()
  }, [file])

  useEffect(() => {
    const index = pendingNameFocusRef.current
    if (index === null) return
    pendingNameFocusRef.current = null
    nameRefs.current[index]?.focus()
  }, [inmateNames.length])
  function setCommitBusy(busy: boolean): void {
    commitBusyRef.current = busy
    onSaveBusyChange?.(busy)
  }

  const inspectMutation = useMutation({
    mutationFn: ({ selected }: { selected: File; id: number }) =>
      api.inspectApprovedViolation(selected),
    onSuccess: (result, variables) => {
      if (variables.id !== requestId.current) return
      setInspection(result)
      setReportDate(result.report_date ?? '')
      setInmateNames(
        result.inmate_names.length > 0 ? result.inmate_names.map((item) => item.name) : [''],
      )
      setSubject(result.proposed_subject)
      fileStatusRef.current?.focus()
    },
    onError: (mutationError, variables) => {
      if (variables.id !== requestId.current) return
      const key = mutationError instanceof ApiError ? ERROR_KEYS[mutationError.code] : undefined
      setError(t(key ?? 'application.approvedViolation.errors.inspectFailed'))
      fileStatusRef.current?.focus()
    },
  })

  const commitMutation = useMutation({
    mutationFn: () =>
      api.commitApprovedViolation({
        token: inspection!.token,
        report_date: reportDate,
        inmate_names: inmateNames.map((name) => name.trim()).filter(Boolean),
        subject: subject.trim(),
      }),
    onSuccess: (result) => {
      setCommitBusy(false)
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['books', 'facets'] })
      onSaved(result)
    },
    onError: (mutationError) => {
      setCommitBusy(false)
      const key = mutationError instanceof ApiError ? ERROR_KEYS[mutationError.code] : undefined
      setError(t(key ?? 'application.approvedViolation.errors.saveFailed'))
    },
  })

  function clearSelection(): void {
    if (commitBusyRef.current || commitMutation.isPending) return
    requestId.current += 1
    setFile(null)
    setInspection(null)
    setReportDate('')
    setInmateNames([''])
    setSubject('')
    setError(null)
    setFieldErrors({})
    inspectMutation.reset()
    commitMutation.reset()
    if (inputRef.current) inputRef.current.value = ''
  }

  function openFilePicker(): void {
    if (commitBusyRef.current || commitMutation.isPending) return
    const input = inputRef.current
    if (!input) return
    input.value = ''
    input.click()
  }

  function selectFile(selected: File): void {
    if (commitBusyRef.current || commitMutation.isPending) return
    setError(null)
    setFieldErrors({})
    if (!(ALLOWED_TYPE[selected.type] || /\.(pdf|png|jpe?g)$/i.test(selected.name))) {
      setError(t('application.approvedViolation.errors.unsupported'))
      return
    }
    if (selected.size === 0) {
      setError(t('application.approvedViolation.errors.empty'))
      return
    }
    if (selected.size > MAX_BYTES) {
      setError(t('application.approvedViolation.errors.tooLarge'))
      return
    }
    const id = requestId.current + 1
    requestId.current = id
    setFile(selected)
    setInspection(null)
    setReportDate('')
    setInmateNames([''])
    setSubject('')
    commitMutation.reset()
    inspectMutation.mutate({ selected, id })
  }


  function validate(): boolean {
    const errors: FieldErrors = {}
    if (!reportDate) errors.reportDate = t('application.approvedViolation.errors.reportDate')
    if (!inmateNames.some((name) => name.trim())) {
      errors.inmateNames = t('application.approvedViolation.errors.inmateNames')
    }
    if (!subject.trim()) errors.subject = t('application.approvedViolation.errors.subject')
    setFieldErrors(errors)
    if (errors.reportDate) dateRef.current?.focus()
    else if (errors.inmateNames) nameRefs.current[0]?.focus()
    else if (errors.subject) subjectRef.current?.focus()
    return Object.keys(errors).length === 0
  }

  const saveDisabled = !inspection || inspectMutation.isPending || commitMutation.isPending

  return (
    <div data-testid="approved-violation-upload" className="space-y-4">
      <input
        disabled={commitMutation.isPending}
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        tabIndex={-1}
        className="sr-only"
        aria-label={t('application.approvedViolation.dropzone')}
        onChange={(event) => {
          const selected = event.currentTarget.files?.[0]
          if (selected) selectFile(selected)
        }}
      />

      {!file ? (
        <div
          ref={dropzoneRef}
          role="button"
          tabIndex={0}
          aria-label={t('application.approvedViolation.dropHint')}
          onClick={openFilePicker}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              openFilePicker()
            }
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            const selected = event.dataTransfer.files[0]
            if (selected) selectFile(selected)
          }}
          className={cn(
            'rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
            dragging
              ? 'border-primary bg-primary/5'
              : 'border-border bg-surface-tinted hover:border-primary hover:bg-primary/5',
          )}
        >
          <UploadCloud className="mx-auto h-8 w-8 text-primary" aria-hidden />
          <p className="mt-3 text-sm font-semibold text-foreground">
            {t('application.approvedViolation.dropzone')}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('application.approvedViolation.dropHint')}
          </p>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {t('application.approvedViolation.limit')}
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10">
            <FileCheck2 className="h-5 w-5 text-primary" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground" dir="ltr">
              {file.name}
            </p>
            <p
              ref={fileStatusRef}
              role="status"
              tabIndex={-1}
              className="rounded-sm font-mono text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {inspection
                ? t('application.approvedViolation.ready')
                : inspectMutation.isError
                  ? t('application.approvedViolation.inspectionFailed')
                  : t('application.approvedViolation.inspecting')}{' '}
              ·{' '}
              <bdi>
                {file.size >= 1_048_576
                  ? `${(file.size / 1_048_576).toFixed(1)} MB`
                  : `${Math.max(1, Math.round(file.size / 1024))} KB`}
              </bdi>
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openFilePicker}
            disabled={commitMutation.isPending}
          >
            {t('application.approvedViolation.replaceFile')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearSelection}
            disabled={commitMutation.isPending}
          >
            {t('application.approvedViolation.removeFile')}
          </Button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2.5 text-sm text-accent"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </div>
      )}

      {file && (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Suspense
            fallback={
              <div
                role="status"
                className="grid min-h-72 place-items-center rounded-2xl border border-border bg-surface-tinted text-sm text-muted-foreground"
              >
                <span className="flex items-center gap-2">
                  <Loader2
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                    aria-hidden
                  />
                  {t('application.approvedViolation.previewLoading')}
                </span>
              </div>
            }
          >
            <ApprovedViolationPreview file={file} />
          </Suspense>

          {inspection && (
            <form
              data-testid="approved-violation-form"
              className="space-y-4 rounded-2xl border border-border bg-surface p-4 sm:p-5"
              onSubmit={(event) => {
                event.preventDefault()
                if (commitBusyRef.current || commitMutation.isPending) return
                setError(null)
                if (validate()) {
                  setCommitBusy(true)
                  commitMutation.mutate()
                }
              }}
            >
              <div className="border-s-4 border-s-primary ps-3">
                <div className="flex items-start gap-2 text-sm font-semibold text-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  {t('application.approvedViolation.approvedNotice')}
                </div>
              </div>

              {inspection.warnings.length > 0 && (
                <div className="rounded-xl border border-warning/35 bg-warning/10 px-3 py-2.5">
                  <p className="text-xs font-semibold text-foreground">
                    {t('application.approvedViolation.ocrWarning')}
                  </p>
                  <ul className="mt-1 list-disc space-y-1 ps-5 text-xs text-muted-foreground">
                    {inspection.warnings.map((warning) => (
                      <li key={warning}>
                        {t(
                          WARNING_KEYS[warning] ??
                            'application.approvedViolation.warnings.reviewExtracted',
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="approved-violation-report-date"
                  className="block text-sm font-medium text-foreground"
                >
                  {t('application.approvedViolation.reportDate')}
                </label>
                <input
                  id="approved-violation-report-date"
                  ref={dateRef}
                  type="date"
                  value={reportDate}
                  aria-invalid={Boolean(fieldErrors.reportDate)}
                  aria-describedby={
                    fieldErrors.reportDate ? 'approved-violation-report-date-error' : undefined
                  }
                  onChange={(event) => {
                    setReportDate(event.target.value)
                    setFieldErrors((current) => ({ ...current, reportDate: undefined }))
                  }}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                />
                {fieldErrors.reportDate && (
                  <p id="approved-violation-report-date-error" className="text-xs text-accent">
                    {fieldErrors.reportDate}
                  </p>
                )}
              </div>

              <fieldset
                className="space-y-2"
                aria-describedby={
                  fieldErrors.inmateNames ? 'approved-violation-inmate-names-error' : undefined
                }
              >
                <legend className="text-sm font-medium text-foreground">
                  {t('application.approvedViolation.inmateNames')}
                </legend>
                {inmateNames.map((name, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <label className="min-w-0 flex-1 space-y-1">
                      <span className="sr-only">
                        {t('application.approvedViolation.inmateNameLabel', {
                          number: index + 1,
                        })}
                      </span>
                      <input
                        ref={(node) => {
                          nameRefs.current[index] = node
                        }}
                        value={name}
                        placeholder={t('application.approvedViolation.namePlaceholder')}
                        aria-invalid={Boolean(fieldErrors.inmateNames)}
                        aria-describedby={
                          fieldErrors.inmateNames
                            ? 'approved-violation-inmate-names-error'
                            : undefined
                        }
                        onChange={(event) => {
                          const next = [...inmateNames]
                          next[index] = event.target.value
                          setInmateNames(next)
                          setFieldErrors((current) => ({ ...current, inmateNames: undefined }))
                        }}
                        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                      />
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('application.approvedViolation.removeName', {
                        number: index + 1,
                      })}
                      onClick={() => {
                        const next = inmateNames.filter((_, itemIndex) => itemIndex !== index)
                        const names = next.length > 0 ? next : ['']
                        pendingNameFocusRef.current = Math.min(index, names.length - 1)
                        setInmateNames(names)
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                ))}
                {fieldErrors.inmateNames && (
                  <p id="approved-violation-inmate-names-error" className="text-xs text-accent">
                    {fieldErrors.inmateNames}
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    pendingNameFocusRef.current = inmateNames.length
                    setInmateNames((current) => [...current, ''])
                  }}
                >
                  <Plus className="me-1.5 h-4 w-4" aria-hidden />
                  {t('application.approvedViolation.addName')}
                </Button>
              </fieldset>

              <div className="space-y-1.5">
                <label
                  htmlFor="approved-violation-subject"
                  className="block text-sm font-medium text-foreground"
                >
                  {t('application.approvedViolation.subject')}
                </label>
                <input
                  id="approved-violation-subject"
                  ref={subjectRef}
                  value={subject}
                  aria-invalid={Boolean(fieldErrors.subject)}
                  aria-describedby={
                    fieldErrors.subject ? 'approved-violation-subject-error' : undefined
                  }
                  onChange={(event) => {
                    setSubject(event.target.value)
                    setFieldErrors((current) => ({ ...current, subject: undefined }))
                  }}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                />
                {fieldErrors.subject && (
                  <p id="approved-violation-subject-error" className="text-xs text-accent">
                    {fieldErrors.subject}
                  </p>
                )}
              </div>

              <Button type="submit" className="w-full sm:w-auto" disabled={saveDisabled}>
                {commitMutation.isPending && (
                  <Loader2
                    className="me-2 h-4 w-4 animate-spin motion-reduce:animate-none"
                    aria-hidden
                  />
                )}
                {commitMutation.isPending
                  ? t('application.approvedViolation.saving')
                  : t('application.approvedViolation.save')}
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
