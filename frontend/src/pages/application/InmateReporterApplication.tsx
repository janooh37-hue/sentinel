import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Download, ExternalLink, Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'

import { TemplateForm } from '@/components/application/TemplateForm'
import type { TemplateDetailResponse, TemplateField } from '@/components/application/types'
import { Button } from '@/components/ui/button'
import { api, ApiError, apiErrorMessage } from '@/lib/api'
import type {
  DocumentGenerateRequest,
  JobStatusResponse,
  SessionUser,
} from '@/lib/api'
import { nowHM, todayIso } from './resignationDate'
import { savedGenerationFromJob, type SavedGeneration } from './savedGeneration'

const DocPdfCanvas = lazy(() => import('./DocPdfCanvas'))
const TEMPLATE_ID = 'Inmate Conduct Violations'
const TEMPLATE_SLUG = 'inmate_conduct_violations'
const EDITABLE_FIELDS: Record<string, true> = {
  report_date: true,
  report_time: true,
  inmates: true,
  violation_details: true,
  action_notified: true,
  action_written: true,
  action_transferred: true,
  action_other: true,
}
const INMATE_ROW_KEYS = ['name', 'nationality', 'wing', 'uid', 'holding_no'] as const
const INMATE_FIELD_LOCALE_KEY: Record<string, string> = {
  name: 'application.inmatesTable.name',
  nationality: 'application.inmatesTable.nationality',
  wing: 'application.inmatesTable.wing',
  uid: 'application.inmatesTable.uid',
  holding_no: 'application.inmatesTable.holdingNo',
}


interface SubmissionIssue {
  kind: 'incomplete' | 'manager' | 'stale' | 'other'
  fields?: string[]
  message?: string
}
interface RestrictedSchemaSource {
  meta: TemplateDetailResponse['meta']
  fields: unknown[]
}

function editableFields(values: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    report_date: '',
    report_time: '',
    inmates: [],
    violation_details: '',
    action_notified: false,
    action_written: false,
    action_transferred: false,
    action_other: '',
  }
  for (const key of Object.keys(EDITABLE_FIELDS)) {
    if (key === 'inmates' || values[key] === undefined) continue
    fields[key] = values[key]
  }
  if (Array.isArray(values.inmates)) {
    fields.inmates = values.inmates.map((value) => {
      const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
      return Object.fromEntries(INMATE_ROW_KEYS.map((key) => [key, row[key] ?? '']))
    })
  }
  return fields
}

function restrictedSchema(raw: RestrictedSchemaSource | undefined): TemplateDetailResponse | null {
  if (!raw) return null
  return {
    meta: raw.meta,
    needs_manager: false,
    needs_submitter: false,
    fields: (raw.fields as TemplateField[]).filter((field) => EDITABLE_FIELDS[field.id]),
  }
}

export function InmateReporterApplication({ user }: { user: SessionUser }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const qc = useQueryClient()
  const [initialBookId] = useState(
    () => ((location.state as { reviseBookId?: number } | null)?.reviseBookId ?? null),
  )
  const [editingBookId, setEditingBookId] = useState<number | null>(initialBookId)
  const [activeTab, setActiveTab] = useState<'fields' | 'preview'>('fields')
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [lastSaved, setLastSaved] = useState<SavedGeneration | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submissionIssue, setSubmissionIssue] = useState<SubmissionIssue | null>(null)
  const submitAfterSaveRef = useRef(false)
  const revisionAppliedRef = useRef(false)
  const newFormSeededRef = useRef(false)
  const form = useForm<Record<string, unknown>>({ defaultValues: {} })

  useEffect(() => {
    if (
      searchParams.get('form') === TEMPLATE_SLUG &&
      !searchParams.has('mode') &&
      !searchParams.has('employee_id')
    ) return
    setSearchParams({ form: TEMPLATE_SLUG }, { replace: true })
  }, [searchParams, setSearchParams])

  const schemaQuery = useQuery({
    queryKey: ['template-fields', TEMPLATE_ID],
    queryFn: () => api.getTemplateFields(TEMPLATE_ID),
    staleTime: Infinity,
  })
  const schema = useMemo(() => restrictedSchema(schemaQuery.data), [schemaQuery.data])

  const revisionBookQuery = useQuery({
    queryKey: ['books', 'detail', initialBookId],
    queryFn: () => api.getBook(initialBookId!),
    enabled: initialBookId !== null,
  })
  const revisionVersion = revisionBookQuery.data?.versions?.at(-1)
  const revisionFieldsQuery = useQuery({
    queryKey: ['books', initialBookId, 'revise-fields'],
    queryFn: () => api.getBookVersionFields(initialBookId!, revisionVersion!.id),
    enabled: initialBookId !== null && revisionVersion !== undefined,
    staleTime: Infinity,
  })
  const isReturnedRevision = revisionBookQuery.data?.approval_state === 'returned'

  useEffect(() => {
    if (!schema) return
    if (initialBookId !== null) {
      if (revisionFieldsQuery.data && !revisionAppliedRef.current) {
        form.reset(editableFields(revisionFieldsQuery.data.fields as Record<string, unknown>))
        revisionAppliedRef.current = true
      }
      return
    }
    if (newFormSeededRef.current) return
    form.reset({ report_date: todayIso(), report_time: nowHM(), inmates: [] })
    newFormSeededRef.current = true
  }, [form, initialBookId, revisionFieldsQuery.data, schema])

  const handleSubmitError = useCallback((error: unknown) => {
    if (!(error instanceof ApiError)) {
      const message = apiErrorMessage(error)
      setSubmissionIssue({ kind: 'other', message })
      toast.error(message)
      return
    }
    if (error.code === 'INMATE_REPORT_INCOMPLETE') {
      const fields = Array.isArray(error.details.fields)
        ? error.details.fields.filter((field): field is string => typeof field === 'string')
        : []
      setSubmissionIssue({ kind: 'incomplete', fields })
      setLastSaved(null)
      setActiveTab('fields')
      toast.error(t('application.inmateReporter.incomplete'))
      return
    }
    if (error.code === 'INMATE_REPORTER_MANAGER_UNAVAILABLE') {
      setSubmissionIssue({ kind: 'manager' })
      toast.error(t('application.inmateReporter.managerUnavailable'))
      return
    }
    if (
      error.code === 'INMATE_REPORTER_STATE_LOCKED' ||
      error.code === 'INMATE_REPORTER_NOT_OWNER' ||
      error.code === 'INMATE_REPORTER_IDENTITY_CHANGED'
    ) {
      setSubmissionIssue({ kind: 'stale' })
      toast.error(t('application.inmateReporter.stale'))
      return
    }
    setSubmissionIssue({ kind: 'other', message: apiErrorMessage(error) })
    toast.error(apiErrorMessage(error))
  }, [t])

  const submitMutation = useMutation({
    mutationFn: (bookId: number) =>
      api.submitBook(bookId, {
        priority: 'Normal',
        approver_user_id: null,
        reviewer_user_ids: [],
      }),
    onSuccess: () => {
      setSubmitted(true)
      setSubmissionIssue(null)
      toast.success(t('application.inmateReporter.sent'))
      void qc.invalidateQueries({ queryKey: ['books'] })
    },
    onError: handleSubmitError,
  })

  const buildPayload = useCallback((values: Record<string, unknown>): DocumentGenerateRequest => ({
    employee_id: null,
    template_id: TEMPLATE_ID,
    fields: editableFields(values),
    manager_id: null,
    submitter_id: null,
    embed_signature: null,
    commit: true,
    ...(editingBookId === null ? {} : { revise_of_book_id: editingBookId }),
    attachments: null,
    classification_code: null,
    notify_employee: false,
  }), [editingBookId])

  const generateMutation = useMutation({
    mutationFn: (body: DocumentGenerateRequest) => api.generateDocument(body),
    onSuccess: (response) => {
      setActiveJobId(response.job_id)
      setLastSaved(null)
      setSubmitted(false)
      setSubmissionIssue(null)
      setActiveTab('preview')
    },
    onError: (error) => {
      submitAfterSaveRef.current = false
      handleSubmitError(error)
    },
  })

  const save = (submitAfterSave = false): void => {
    if (!user.employee_id) return
    submitAfterSaveRef.current = submitAfterSave
    setSubmissionIssue(null)
    generateMutation.mutate(buildPayload(form.getValues()))
  }

  const handleJobDone = useCallback((job: JobStatusResponse) => {
    if (job.status === 'failed') {
      submitAfterSaveRef.current = false
      return
    }
    const saved = savedGenerationFromJob(job)
    if (!saved) {
      submitAfterSaveRef.current = false
      return
    }
    setLastSaved(saved)
    setEditingBookId(saved.bookId)
    toast.success(t('application.inmateReporter.saved', { ref: saved.ref }))
    void qc.invalidateQueries({ queryKey: ['books'] })
    if (submitAfterSaveRef.current) {
      submitAfterSaveRef.current = false
      submitMutation.mutate(saved.bookId)
    }
  }, [qc, submitMutation, t])

  const displayName = (
    isAr ? user.name_ar || user.name_en : user.name_en || user.name_ar
  ) || user.email
  const busy = generateMutation.isPending || submitMutation.isPending

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 pb-10 pt-6 sm:px-8">
        <header className="mb-5">
          <div className="text-[0.75em] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {t('application.eyebrow')}
          </div>
          <h1 className="mt-1 text-[1.7em] font-bold tracking-tight text-foreground">
            {(isAr ? schema?.meta.name_ar : schema?.meta.name_en) || t('application.inmateReporter.title')}
          </h1>
          <p className="mt-1 text-[0.86em] text-muted-foreground">
            {t('application.inmateReporter.description')}
          </p>
        </header>

        {!user.employee_id && (
          <div role="alert" className="mb-4 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
            {t('application.inmateReporter.unlinked')}
          </div>
        )}

        <section className="rounded-2xl bg-surface px-4 py-6 sm:px-7">
          <div className="mb-5 flex items-center gap-1 border-b border-hairline pb-4">
            <Button type="button" size="sm" variant={activeTab === 'fields' ? 'default' : 'ghost'} onClick={() => setActiveTab('fields')}>
              {t('application.tabs.fields')}
            </Button>
            <Button type="button" size="sm" variant={activeTab === 'preview' ? 'default' : 'ghost'} disabled={!activeJobId} onClick={() => setActiveTab('preview')}>
              {t('application.tabs.preview')}
            </Button>
          </div>

          {activeTab === 'fields' && (
            <div>
              <div className="mb-6 rounded-xl border border-hairline bg-surface-tinted px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('application.inmateReporter.reportedBy')}
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold text-foreground" dir="auto">{displayName}</span>
                  <span className="font-mono text-sm text-muted-foreground" dir="ltr">
                    {user.employee_id ?? t('application.inmateReporter.notLinked')}
                  </span>
                </div>
              </div>

              {submissionIssue && (
                <SubmissionIssuePanel
                  issue={submissionIssue}
                  schema={schema}
                  onContinue={() => {
                    setSubmissionIssue(null)
                    setActiveTab('fields')
                  }}
                />
              )}

              {schemaQuery.isLoading || revisionFieldsQuery.isLoading ? (
                <div className="flex min-h-40 items-center justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" aria-label={t('common.loading')} />
                </div>
              ) : schemaQuery.isError || revisionBookQuery.isError || revisionFieldsQuery.isError ? (
                <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {t('application.inmateReporter.loadError')}
                </p>
              ) : schema ? (
                <form onSubmit={(event) => { event.preventDefault(); save(false) }} noValidate>
                  <TemplateForm templateId={TEMPLATE_ID} schema={schema} form={form} />
                  <div className="mt-7 flex flex-wrap items-center justify-between gap-2.5 border-t border-hairline pt-4">
                    <p className="text-[0.78em] text-muted-foreground">
                      {t('application.inmateReporter.saveHint')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" variant="outline" disabled={!user.employee_id || busy}>
                        {generateMutation.isPending
                          ? t('application.inmateReporter.saving')
                          : t('application.inmateReporter.saveDraft')}
                      </Button>
                      {isReturnedRevision && (
                        <Button type="button" disabled={!user.employee_id || busy} onClick={() => save(true)}>
                          <Send className="h-4 w-4" aria-hidden />
                          {submitMutation.isPending
                            ? t('application.inmateReporter.sending')
                            : t('application.inmateReporter.correctReport')}
                        </Button>
                      )}
                    </div>
                  </div>
                </form>
              ) : null}
            </div>
          )}

          {activeTab === 'preview' && activeJobId && (
            <div className="space-y-4">
              <RestrictedJobStatus key={activeJobId} jobId={activeJobId} onDone={handleJobDone} />
              {lastSaved && (
                <div className="rounded-xl border border-hairline bg-surface-tinted p-4">
                  <p className="font-semibold text-foreground">
                    {t('application.inmateReporter.saved', { ref: lastSaved.ref })}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!submitted && (
                      <Button
                        type="button"
                        disabled={!user.employee_id || submitMutation.isPending}
                        onClick={() => submitMutation.mutate(lastSaved.bookId)}
                      >
                        <Send className="h-4 w-4" aria-hidden />
                        {submitMutation.isPending
                          ? t('application.inmateReporter.sending')
                          : isReturnedRevision
                            ? t('application.inmateReporter.correctReport')
                            : t('application.inmateReporter.sendToManager')}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setLastSaved(null)
                        setActiveTab('fields')
                      }}
                    >
                      {t('application.inmateReporter.continueEditing')}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => navigate(`/books/${lastSaved.bookId}`)}>
                      <ExternalLink className="h-4 w-4" aria-hidden />
                      {t('books.pane.openRecord')}
                    </Button>
                  </div>
                  {submitted && (
                    <p role="status" className="mt-3 text-sm font-medium text-success">
                      {t('application.inmateReporter.sent')}
                    </p>
                  )}
                  {submissionIssue && (
                    <div className="mt-3">
                      <SubmissionIssuePanel
                        issue={submissionIssue}
                        schema={schema}
                        onContinue={() => setActiveTab('fields')}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function SubmissionIssuePanel({
  issue,
  schema,
  onContinue,
}: {
  issue: SubmissionIssue
  schema: TemplateDetailResponse | null
  onContinue: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const fieldLabel = (path: string): string => {
    const fieldId = path.match(/^[^.[\]]+/)?.[0] ?? path
    const field = schema?.fields.find((candidate) => candidate.id === fieldId)
    const base = field ? (isAr ? field.label_ar || field.label_en : field.label_en) : path
    const inmateCell = path.match(/^inmates\[(\d+)\]\.(name|nationality|wing|uid|holding_no)$/)
    if (!inmateCell) return base
    return `${base} · ${t(INMATE_FIELD_LOCALE_KEY[inmateCell[2]])} · ${Number(inmateCell[1]) + 1}`
  }
  const message = issue.kind === 'incomplete'
    ? t('application.inmateReporter.incomplete')
    : issue.kind === 'manager'
      ? t('application.inmateReporter.managerUnavailable')
      : issue.kind === 'stale'
        ? t('application.inmateReporter.stale')
        : issue.message
  return (
    <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
      <p>{message}</p>
      {issue.fields && issue.fields.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 ps-5 text-xs" dir="auto">
          {issue.fields.map((field) => <li key={field}>{fieldLabel(field)}</li>)}
        </ul>
      )}
      {issue.kind === 'incomplete' && (
        <Button type="button" size="sm" variant="outline" className="mt-3" onClick={onContinue}>
          {t('application.inmateReporter.continueEditing')}
        </Button>
      )}
      {issue.kind === 'stale' && (
        <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => window.location.reload()}>
          {t('application.inmateReporter.reload')}
        </Button>
      )}
    </div>
  )
}

function RestrictedJobStatus({
  jobId,
  onDone,
}: {
  jobId: string
  onDone: (job: JobStatusResponse) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [job, setJob] = useState<JobStatusResponse | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const onDoneRef = useRef(onDone)
  useEffect(() => { onDoneRef.current = onDone }, [onDone])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      try {
        const next = await api.getJob(jobId)
        if (cancelled) return
        setJob(next)
        setPollError(null)
        if (next.status === 'done' || next.status === 'failed') onDoneRef.current(next)
        else timer = setTimeout(() => { void poll() }, 750)
      } catch (error) {
        if (cancelled) return
        setPollError(apiErrorMessage(error))
        timer = setTimeout(() => { void poll() }, 2_000)
      }
    }
    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [jobId])

  if (!job || job.status === 'queued' || job.status === 'running') {
    return (
      <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        <p>{t(`application.jobStatus.${job?.status ?? 'queued'}`)}</p>
        {pollError && <p className="text-xs text-destructive">{pollError}</p>}
      </div>
    )
  }
  if (job.status === 'failed') {
    return (
      <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-4 text-center text-sm text-destructive">
        <p>{job.error_message || t('application.jobStatus.failed')}</p>
        {job.error_code && <p className="mt-1 font-mono text-xs">{job.error_code}</p>}
      </div>
    )
  }

  const document = job.documents?.find((item) => item.role === 'primary')
  if (!document?.pdf_url) {
    return (
      <div className="flex min-h-52 items-center justify-center rounded-lg border border-hairline bg-surface-tinted text-sm text-muted-foreground">
        {t('application.pdfUnavailableNoDocx')}
      </div>
    )
  }
  return (
    <div>
      <Suspense fallback={<div className="flex min-h-52 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
        <DocPdfCanvas pdfUrl={document.pdf_url} />
      </Suspense>
      <a href={document.pdf_url} download className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg border border-hairline px-3 text-sm font-medium text-foreground hover:bg-surface-tinted">
        <Download className="h-4 w-4" aria-hidden />
        {t('application.downloadPdf')}
      </a>
    </div>
  )
}
