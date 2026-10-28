/**
 * Ledger Book composer — `/ledger/compose/:draftId`. A private draft with no
 * number: Tab, Grade, Importance, ordered Subject lines and the HugeRTE body,
 * autosaved as the writer types. Save & Send allocates the reference number
 * and opens the issued book on the desk.
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Eye, EyeOff, Send, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { GradeSelect } from '@/components/books/GradeSelect'
import { GRADE_META } from '@/components/books/grades'
import { deskBookUrl, LEDGER_DRAFTS_KEY, ledgerDraftKey } from '@/components/books/ledgerBookKeys'
import { LedgerPaperFrame } from '@/components/books/LedgerPaperFrame'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { api, ApiError, apiErrorMessage, type LedgerDraftRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { composerSchema, valuesFromDraft, type ComposerValues } from './composerForm'
import { ImportancePicker } from './ImportancePicker'
import { LedgerBodyEditor } from './LedgerBodyEditor'
import { SubjectLines } from './SubjectLines'
import { useDraftAutosave, type SaveState } from './useDraftAutosave'

const AUTOSAVE_MS = 800

type Field = 'tab' | 'subjects' | 'body'
type FieldErrors = Partial<Record<Field, string>>

/** Save & Send refusals that belong next to a field. */
const FIELD_OF_CODE: Readonly<Record<string, Field>> = {
  DRAFT_TAB_REQUIRED: 'tab',
  DRAFT_SUBJECT_REQUIRED: 'subjects',
  DRAFT_BODY_REQUIRED: 'body',
}

class DraftNotSaved extends Error {}

/** `/ledger/compose` starts a new draft; `/ledger/compose/:draftId` edits one. */
export function LedgerComposerPage({ autosaveMs = AUTOSAVE_MS }: { autosaveMs?: number }): React.JSX.Element {
  const param = useParams().draftId
  return param === undefined ? <NewDraft /> : <DraftLoader draftId={Number(param)} autosaveMs={autosaveMs} />
}

function Failed({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-3 p-6">
      <p role="alert">{t('ledgerBook.composer.loadFailed')}</p>
      <Button type="button" variant="outline" onClick={onRetry}>{t('ledgerBook.composer.retry')}</Button>
    </div>
  )
}

function NewDraft(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const started = useRef(false)
  const create = useMutation({
    mutationFn: () => api.createLedgerDraft({ grade: 'unclassified', body_html: '' }),
    onSuccess: (draft) => {
      qc.setQueryData(ledgerDraftKey(draft.id), draft)
      void qc.invalidateQueries({ queryKey: LEDGER_DRAFTS_KEY, exact: true })
      navigate(`/ledger/compose/${draft.id}`, { replace: true })
    },
  })
  const { mutate } = create
  useEffect(() => {
    // One draft per visit, also under StrictMode's double effect run.
    if (started.current) return
    started.current = true
    mutate()
  }, [mutate])
  if (create.isError) return <Failed onRetry={() => create.mutate()} />
  return <p role="status" className="p-6 text-muted-foreground">{t('ledgerBook.composer.creating')}</p>
}

function DraftLoader({ draftId, autosaveMs }: { draftId: number; autosaveMs: number }): React.JSX.Element {
  const { t } = useTranslation()
  const query = useQuery({ queryKey: ledgerDraftKey(draftId), queryFn: () => api.getLedgerDraft(draftId), staleTime: Infinity })
  if (query.isError) return <Failed onRetry={() => void query.refetch()} />
  if (!query.data) return <p role="status" className="p-6 text-muted-foreground">{t('ledgerBook.composer.loading')}</p>
  return <Composer key={draftId} draft={query.data} autosaveMs={autosaveMs} />
}

function Composer({ draft, autosaveMs }: { draft: LedgerDraftRead; autosaveMs: number }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const tabId = useId()
  const bodyErrorId = useId()
  const [initial] = useState(() => valuesFromDraft(draft))
  const form = useForm<ComposerValues>({ resolver: zodResolver(composerSchema), defaultValues: initial })
  const values = useWatch({ control: form.control }) as ComposerValues
  const autosave = useDraftAutosave(draft.id, values, initial, autosaveMs)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [confirm, setConfirm] = useState<'send' | 'delete' | null>(null)
  const [preview, setPreview] = useState(false)
  const previewId = useId()
  const classifications = useQuery({
    queryKey: ['books', 'classifications'],
    queryFn: () => api.listBookClassifications(),
    staleTime: Infinity,
  })
  const tabs = classifications.data?.items ?? []
  const grade = GRADE_META[values.grade]
  const GradeIcon = grade.icon
  const draftLabel = t('ledgerBook.composer.draftLabel', { number: draft.draft_number })

  const clearError = (field: Field): void => setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
  const forgetDraft = (): void => {
    qc.removeQueries({ queryKey: ledgerDraftKey(draft.id) })
    void qc.invalidateQueries({ queryKey: LEDGER_DRAFTS_KEY, exact: true })
  }

  const send = useMutation({
    mutationFn: async () => {
      if (!(await autosave.flush(form.getValues()))) throw new DraftNotSaved()
      return api.saveAndSendLedgerDraft(draft.id)
    },
    onSuccess: (book) => {
      forgetDraft()
      toast.success(t('ledgerBook.composer.send.sent', { ref: bidi(book.ref_number) }))
      navigate(deskBookUrl(book.id))
    },
    onError: (err) => {
      if (err instanceof DraftNotSaved) return toast.error(t('ledgerBook.composer.save.failed'))
      const field = err instanceof ApiError ? FIELD_OF_CODE[err.code] : undefined
      if (field) setErrors({ [field]: apiErrorMessage(err) })
      else toast.error(apiErrorMessage(err))
    },
  })

  const remove = useMutation({
    mutationFn: () => api.deleteLedgerDraft(draft.id),
    onSuccess: () => {
      forgetDraft()
      toast.success(t('ledgerBook.composer.delete.deleted'))
      navigate('/ledger?tab=books')
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const uploadImage = useCallback(
    async (file: Blob, filename: string) => (await api.uploadLedgerDraftImage(draft.id, file, filename)).src,
    [draft.id],
  )

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4 sm:px-6">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          to="/ledger?tab=books"
          className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-[0.84em] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
          {t('ledgerBook.composer.back')}
        </Link>
        <h1 className="me-auto text-lg font-semibold">
          <span className="text-muted-foreground">{t('ledgerBook.composer.title')} · </span>
          <bdi>{draftLabel}</bdi>
        </h1>
        <SaveStatus state={autosave.state} />
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button
            type="button"
            variant="outline"
            aria-expanded={preview}
            aria-controls={previewId}
            onClick={() => {
              if (!preview) void autosave.flush(form.getValues())
              setPreview(!preview)
            }}
          >
            {preview ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
            {t(preview ? 'ledgerBook.composer.preview.hide' : 'ledgerBook.composer.preview.show')}
          </Button>
          <Button type="button" variant="outline" disabled={remove.isPending || send.isPending} onClick={() => setConfirm('delete')}>
            <Trash2 aria-hidden="true" className="size-4" />
            {t('ledgerBook.composer.delete.button')}
          </Button>
          <Button type="button" className="flex-1 sm:flex-none" disabled={send.isPending || remove.isPending} onClick={() => setConfirm('send')}>
            <Send aria-hidden="true" className="size-4 rtl:-scale-x-100" />
            {t('ledgerBook.composer.send.button')}
          </Button>
        </div>
      </header>

      <div
        className={cn('flex items-center gap-2 rounded-lg px-3 py-2 text-[0.84em] font-semibold', grade.className || 'bg-muted text-muted-foreground')}
        data-grade={values.grade}
      >
        {GradeIcon && <GradeIcon aria-hidden="true" className="size-4" />}
        {t('ledgerBook.composer.fields.gradeBanner', { label: t('books.grade.label'), grade: t(grade.label) })}
      </div>

      <div className={cn('grid gap-6', preview && 'lg:grid-cols-2')}>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={tabId} className="text-[0.78em] font-semibold text-muted-foreground">{t('ledgerBook.composer.fields.tab')}</label>
              <Controller
                control={form.control}
                name="tab"
                render={({ field }) => (
                  <select
                    id={tabId}
                    value={field.value ?? ''}
                    onChange={(e) => {
                      clearError('tab')
                      field.onChange(e.target.value === '' ? null : Number(e.target.value))
                    }}
                    aria-invalid={errors.tab ? true : undefined}
                    aria-describedby={errors.tab ? `${tabId}-error` : undefined}
                    className="min-h-10 w-full rounded-lg border border-hairline bg-background px-3 py-2 text-[0.84em] text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 aria-[invalid=true]:border-destructive"
                  >
                    <option value="">{t('ledgerBook.composer.fields.tabPlaceholder')}</option>
                    {tabs.map((c) => (
                      <option key={c.code} value={c.tab}>
                        {t('ledgerBook.composer.fields.tabOption', { tab: c.tab, name: isAr ? c.name_ar : c.name_en })}
                      </option>
                    ))}
                  </select>
                )}
              />
              {errors.tab && <p id={`${tabId}-error`} role="alert" className="text-[0.78em] text-destructive">{errors.tab}</p>}
            </div>
            <Controller
              control={form.control}
              name="grade"
              render={({ field }) => <GradeSelect value={field.value} onChange={field.onChange} />}
            />
            <Controller
              control={form.control}
              name="importance"
              render={({ field }) => <ImportancePicker value={field.value} onChange={field.onChange} />}
            />
          </div>

          <Controller
            control={form.control}
            name="subjects"
            render={({ field }) => (
              <SubjectLines
                value={field.value}
                onChange={(lines) => {
                  clearError('subjects')
                  field.onChange(lines)
                }}
                error={errors.subjects}
              />
            )}
          />

          <div className="flex flex-col gap-1">
            <span className="text-[0.78em] font-semibold text-muted-foreground">{t('ledgerBook.composer.body.label')}</span>
            <Controller
              control={form.control}
              name="body_html"
              render={({ field }) => (
                <LedgerBodyEditor
                  value={field.value}
                  onChange={(html) => {
                    clearError('body')
                    field.onChange(html)
                  }}
                  label={t('ledgerBook.composer.body.label')}
                  onUploadImage={uploadImage}
                  invalid={Boolean(errors.body)}
                  describedBy={errors.body ? bodyErrorId : undefined}
                />
              )}
            />
            {errors.body && <p id={bodyErrorId} role="alert" className="text-[0.78em] text-destructive">{errors.body}</p>}
          </div>
        </div>
        {preview && (
          <section id={previewId} aria-label={t('ledgerBook.composer.paper.title')} className="min-w-0 lg:sticky lg:top-4 lg:self-start">
            <LedgerPaperFrame source={{ draftId: draft.id }} reloadKey={autosave.savedCount} className="lg:h-[calc(100vh-8rem)]" />
          </section>
        )}
      </div>

      <ConfirmDialog
        open={confirm === 'send'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('ledgerBook.composer.send.confirmTitle')}
        description={t('ledgerBook.composer.send.confirmBody')}
        confirmLabel={t('ledgerBook.composer.send.button')}
        onConfirm={() => send.mutate()}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('ledgerBook.composer.delete.confirmTitle')}
        description={t('ledgerBook.composer.delete.confirmBody')}
        confirmLabel={t('ledgerBook.composer.delete.button')}
        destructive
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}

function SaveStatus({ state }: { state: SaveState }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <p role="status" className={cn('text-[0.78em]', state === 'failed' ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
      {state === 'saving' && t('ledgerBook.composer.save.saving')}
      {state === 'saved' && t('ledgerBook.composer.save.saved')}
      {state === 'failed' && t('ledgerBook.composer.save.failed')}
    </p>
  )
}
