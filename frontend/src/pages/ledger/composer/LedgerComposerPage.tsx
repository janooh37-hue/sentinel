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
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom'

import { GradeSelect } from '@/components/books/GradeSelect'
import { GRADE_META } from '@/components/books/grades'
import { deskBookUrl, LEDGER_DRAFTS_KEY, ledgerDraftKey } from '@/components/books/ledgerBookKeys'
import { LedgerPaperPdf } from '@/components/books/LedgerPaperPdf'
import { SigningManagerPicker } from '@/components/books/SigningManagerPicker'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { api, ApiError, apiErrorMessage, type LedgerDraftRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/lib/useIsMobile'
import { composerSchema, valuesFromDraft, type ComposerValues } from './composerForm'
import { ImportancePicker } from './ImportancePicker'
import { LedgerAddresseesPicker } from './LedgerAddresseesPicker'
import { LedgerBodyEditor, type LedgerBodyEditorHandle } from './LedgerBodyEditor'
import { LedgerReferencesPicker } from './LedgerReferencesPicker'
import { LedgerFoldersPicker } from './LedgerFoldersPicker'
import { SubjectLines } from './SubjectLines'
import { useDraftAutosave, type SaveState } from './useDraftAutosave'

const AUTOSAVE_MS = 800

type Field = 'tab' | 'subjects' | 'addressedTo' | 'body' | 'to' | 'signer' | 'references' | 'folders'
type FieldErrors = Partial<Record<Field, string>>

/** Save & Send refusals that belong next to a field. */
const FIELD_OF_CODE: Readonly<Record<string, Field>> = {
  DRAFT_TAB_REQUIRED: 'tab',
  DRAFT_SUBJECT_REQUIRED: 'subjects',
  ADDRESSED_TO_REQUIRED: 'addressedTo',
  DRAFT_BODY_REQUIRED: 'body',
  DRAFT_TO_REQUIRED: 'to',
  ADDRESSEE_INVALID: 'to',
  DRAFT_SIGNER_REQUIRED: 'signer',
  SIGNER_INVALID: 'signer',
  REFERENCE_INVALID: 'references',
  FOLDER_INVALID: 'folders',
  GRADE_BELOW_FLOOR: 'references',
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
  const activeVisit = useRef(false)
  const create = useMutation({
    mutationFn: () => api.createLedgerDraft({ grade: 'unclassified', body_html: '', external: false }),
    onSuccess: (draft) => {
      qc.setQueryData(ledgerDraftKey(draft.id), draft)
      void qc.invalidateQueries({ queryKey: LEDGER_DRAFTS_KEY, exact: true })
      if (activeVisit.current) navigate(`/ledger/compose/${draft.id}`, { replace: true })
    },
  })
  const { mutate } = create
  useEffect(() => {
    activeVisit.current = true
    // One draft per visit, also under StrictMode's double effect run.
    if (!started.current) {
      started.current = true
      mutate()
    }
    return () => { activeVisit.current = false }
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
  const addressedToId = useId()
  const bodyErrorId = useId()
  const toId = useId()
  const signerId = useId()
  const referencesId = useId()
  const foldersId = useId()
  const [initial] = useState(() => valuesFromDraft(draft))
  const sendingRef = useRef(false)
  const [sending, setSending] = useState(false)
  const form = useForm<ComposerValues>({ resolver: zodResolver(composerSchema), defaultValues: initial })
  const [gradeValue, external, paperPreset, addressees, signer] = useWatch({ control: form.control, name: ['grade', 'external', 'paper_preset', 'addressees', 'signer_manager_id'] })
  const values = { grade: gradeValue, external, paper_preset: paperPreset, addressees, signer_manager_id: signer }
  const bodyEditor = useRef<LedgerBodyEditorHandle>(null)
  const backLink = useRef<HTMLAnchorElement>(null)
  const subjectId = useId()
  const bypassNavigation = useRef(false)
  const activeVisit = useRef(false)
  useEffect(() => {
    activeVisit.current = true
    return () => { activeVisit.current = false }
  }, [])
  const [errors, setErrors] = useState<FieldErrors>({})
  const handleFieldError = useCallback((err: unknown): boolean => {
    const field = err instanceof ApiError ? FIELD_OF_CODE[err.code] : undefined
    if (!field) return false
    setErrors({ [field]: apiErrorMessage(err) })
    return true
  }, [setErrors])
  const autosave = useDraftAutosave(draft.id, form, initial, autosaveMs, handleFieldError)
  const { flush, isDirty } = autosave
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !bypassNavigation.current && currentLocation.pathname !== nextLocation.pathname && autosave.isDirty())
  const leaving = useRef(false)
  const [leaveFailed, setLeaveFailed] = useState(false)
  const leave = useCallback(async () => {
    if (leaving.current) return
    leaving.current = true
    do {
      if (!(await flush(form.getValues()))) {
        setLeaveFailed(true)
        leaving.current = false
        return
      }
    } while (isDirty())
    if (blocker.state === 'blocked') blocker.proceed()
    leaving.current = false
  }, [flush, isDirty, form, blocker, setLeaveFailed])
  useEffect(() => {
    if (blocker.state === 'blocked' && !leaveFailed) void Promise.resolve().then(leave)
  }, [blocker.state, leaveFailed, leave])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent): void => {
      if (!bypassNavigation.current && isDirty()) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isDirty])
  const [confirm, setConfirm] = useState<'send' | 'delete' | null>(null)
  const [preview, setPreview] = useState(false)
  const isMobile = useIsMobile()
  const previewTrigger = useRef<HTMLButtonElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!preview || autosave.pending || autosave.state === 'saving' || autosave.state === 'failed') return
    const timer = window.setTimeout(() => {
      setPreviewUrl(api.ledgerDraftPaperPdfUrl(draft.id, autosave.savedAt == null ? draft.updated_at : String(autosave.savedAt)))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [preview, autosave.pending, autosave.state, autosave.savedAt, draft.id, draft.updated_at])
  const previewId = useId()
  useEffect(() => {
    if (confirm) return
    if (errors.body) { bodyEditor.current?.focus(); return }
    if (errors.subjects) { document.getElementById(subjectId)?.focus(); return }
    const field = errors.addressedTo ? addressedToId : errors.to ? toId : errors.signer ? signerId : errors.tab ? tabId : errors.references ? referencesId : errors.folders ? foldersId : undefined
    if (field && !confirm) document.getElementById(field)?.focus()
  }, [errors, confirm, addressedToId, toId, signerId, tabId, referencesId, foldersId, subjectId])
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
    onSettled: () => { sendingRef.current = false; setSending(false) },
    mutationFn: async () => {
      if (!(await autosave.flush(form.getValues()))) throw new DraftNotSaved()
      return api.saveAndSendLedgerDraft(draft.id)
    },
    onSuccess: (book) => {
      bypassNavigation.current = true
      forgetDraft()
      toast.success(t('ledgerBook.composer.send.sent', { ref: bidi(book.ref_number) }))
      if (activeVisit.current) navigate(deskBookUrl(book.id))
    },
    onError: (err) => {
      if (err instanceof DraftNotSaved) return toast.error(t('ledgerBook.composer.save.failed'))
      setConfirm(null)
      if (!handleFieldError(err)) toast.error(apiErrorMessage(err))
    },
  })

  const remove = useMutation({
    mutationFn: () => api.deleteLedgerDraft(draft.id),
    onSuccess: () => {
      bypassNavigation.current = true
      forgetDraft()
      toast.success(t('ledgerBook.composer.delete.deleted'))
      if (activeVisit.current) navigate('/ledger?tab=books')
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const uploadImage = useCallback(
    async (file: Blob, filename: string) => (await api.uploadLedgerDraftImage(draft.id, file, filename)).src,
    [draft.id],
  )

  return (
    <div className="ledger-composer mx-auto flex min-h-0 w-full max-w-[1600px] flex-col gap-4 overflow-y-auto px-3 py-4 sm:px-6">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          ref={backLink}
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
        {autosave.state === 'failed' && <Button type="button" variant="outline" onClick={() => void autosave.flush(form.getValues())}>{t('ledgerBook.composer.retry')}</Button>}
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button
            type="button"
            ref={previewTrigger}
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
          <Button type="button" className="flex-1 sm:flex-none" disabled={send.isPending || remove.isPending || (values.grade === 'addressee_only' && values.addressees.some((a) => a.role === 'cc'))} onClick={() => {
            if (!values.addressees.some((a) => a.role === 'to')) setErrors({ to: t('ledgerBook.composer.errors.toRequired') })
            else if (values.signer_manager_id == null) setErrors({ signer: t('ledgerBook.composer.errors.signerRequired') })
            else setConfirm('send')
          }}>
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

      <div className={cn('grid gap-6', preview && !isMobile && 'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]')}>
        <fieldset disabled={sending} inert={sending} className="flex min-w-0 flex-col gap-4">
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
                      if (sendingRef.current) return
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
              render={({ field }) => <GradeSelect value={field.value} onChange={(v) => { clearError('references'); if (!sendingRef.current) field.onChange(v) }} />}
            />
            <Controller
              control={form.control}
              name="importance"
              render={({ field }) => <ImportancePicker value={field.value} onChange={(value) => { if (!sendingRef.current) field.onChange(value) }} />}
            />
          </div>

          <fieldset>
            <legend className="mb-1 text-[0.78em] font-semibold text-muted-foreground">{t('ledgerBook.composer.preset.label')}</legend>
            <div className="inline-flex rounded-lg border border-border bg-surface-tinted p-1">
              {(['normal', 'report'] as const).map((preset) => <label key={preset} className={cn('relative inline-flex min-h-10 cursor-pointer items-center rounded-md px-5 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', values.paper_preset === preset && 'bg-surface text-primary shadow-sm')}>
                <input className="sr-only" type="radio" name="paper-preset" value={preset} checked={values.paper_preset === preset} onChange={() => { if (!sendingRef.current) form.setValue('paper_preset', preset) }} />
                {t(`ledgerBook.composer.preset.${preset}`)}
              </label>)}
            </div>
          </fieldset>

          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-1 text-[0.78em] font-semibold text-muted-foreground">{t('ledgerBook.composer.fields.kind')}</legend>
            {[false, true].map((external) => <label key={String(external)} className="inline-flex min-h-10 items-center gap-2 text-sm">
              <input type="radio" name="destination" checked={values.external === external} onChange={() => {
                if (sendingRef.current) return
                form.setValue('external', external)
                form.setValue('addressees', [])
              }} />
              {t(external ? 'ledgerBook.composer.fields.external' : 'ledgerBook.composer.fields.internal')}
            </label>)}
          </fieldset>
          <Controller control={form.control} name="addressees" render={({ field }) => <LedgerAddresseesPicker external={values.external} grade={values.grade} value={field.value} onChange={(v) => { clearError('to'); if (!sendingRef.current) field.onChange(v) }} toId={toId} error={errors.to} />} />
          <Controller control={form.control} name="signer_manager_id" render={({ field }) => <SigningManagerPicker id={signerId} value={field.value} onChange={(v) => { clearError('signer'); if (!sendingRef.current) field.onChange(v) }} error={errors.signer} />} />
          <Controller control={form.control} name="reference_book_ids" render={({ field }) => <LedgerReferencesPicker id={referencesId} value={field.value} onChange={(v) => { clearError('references'); if (!sendingRef.current) field.onChange(v) }} error={errors.references} />} />
          <Controller control={form.control} name="folder_ids" render={({ field }) => <LedgerFoldersPicker id={foldersId} value={field.value} onChange={(v) => { clearError('folders'); if (!sendingRef.current) field.onChange(v) }} error={errors.folders} />} />
          <div className="flex flex-col gap-1">
            <label htmlFor={addressedToId} className="text-[0.78em] font-semibold text-muted-foreground">{t('ledgerBook.composer.fields.addressedTo')}</label>
            <Controller control={form.control} name="addressed_to" render={({ field }) => <Input {...field} id={addressedToId} dir="auto" maxLength={500} aria-required="true" aria-invalid={Boolean(errors.addressedTo)} aria-describedby={`${addressedToId}-hint${errors.addressedTo ? ` ${addressedToId}-error` : ''}`} onChange={(event) => { if (!sendingRef.current) { clearError('addressedTo'); field.onChange(event) } }} />} />
            <p id={`${addressedToId}-hint`} className="text-[0.78em] text-muted-foreground">{t('ledgerBook.composer.preset.openingHint')}</p>
            {errors.addressedTo && <p id={`${addressedToId}-error`} role="alert" className="text-[0.78em] text-destructive">{errors.addressedTo}</p>}
          </div>
          <Controller
            control={form.control}
            name="subjects"
            render={({ field }) => (
              <SubjectLines
                firstInputId={subjectId}
                value={field.value}
                onChange={(lines) => {
                  if (sendingRef.current) return
                  clearError('subjects')
                  field.onChange(lines)
                }}
                error={errors.subjects}
              />
            )}
          />

          <div className="flex min-h-[600px] flex-1 flex-col gap-1 [&>div]:flex-1">
            <span className="text-[0.78em] font-semibold text-muted-foreground">{t('ledgerBook.composer.body.label')}</span>
            <Controller
              control={form.control}
              name="body_html"
              render={({ field }) => (
                <LedgerBodyEditor
                  disabled={sending}
                  ref={bodyEditor}
                  errorMessage={errors.body}
                  value={field.value}
                  onChange={(html) => {
                    if (sendingRef.current) return
                    clearError('body')
                    field.onChange(html)
                  }}
                  label={t('ledgerBook.composer.body.label')}
                  onUploadImage={uploadImage}
                  invalid={Boolean(errors.body)}
                  height={Math.max(600, Math.round(window.innerHeight * 0.85))}
                  describedBy={errors.body ? bodyErrorId : undefined}
                />
              )}
            />
            {errors.body && <p id={bodyErrorId} role="alert" className="text-[0.78em] text-destructive">{errors.body}</p>}
          </div>
        </fieldset>
        {preview && !isMobile && (
          <section id={previewId} aria-label={t('ledgerBook.composer.paper.title')} className="min-w-0 lg:sticky lg:top-4 lg:self-start">
            <LedgerPaperPdf url={previewUrl} title={t('ledgerBook.composer.paper.title')} className="h-[calc(100dvh-8rem)]" />
          </section>
        )}
      </div>
      <Sheet open={preview && isMobile} onOpenChange={setPreview}>
        <SheetContent id={isMobile ? previewId : undefined} aria-describedby={undefined} className="end-0 h-dvh w-full" onCloseAutoFocus={(event) => { event.preventDefault(); previewTrigger.current?.focus() }}>
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
            <SheetTitle className="text-sm font-semibold">{t('ledgerBook.composer.paper.title')}</SheetTitle>
            <SheetClose asChild><Button type="button" variant="outline" className="min-h-11">{t('ledgerBook.composer.preview.hide')}</Button></SheetClose>
          </header>
          <LedgerPaperPdf url={previewUrl} title={t('ledgerBook.composer.paper.title')} className="min-h-0 flex-1" />
        </SheetContent>
      </Sheet>

      <AlertDialog open={blocker.state === 'blocked' && leaveFailed} onOpenChange={(open) => { if (!open && blocker.state === 'blocked') { blocker.reset(); setLeaveFailed(false) } }}>
        <AlertDialogContent onCloseAutoFocus={(event) => { event.preventDefault(); backLink.current?.focus() }}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('ledgerBook.composer.navigation.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('ledgerBook.composer.navigation.body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button onClick={() => { setLeaveFailed(false); void leave() }}>{t('ledgerBook.composer.retry')}</Button>
            <Button variant="outline" onClick={() => { if (blocker.state === 'blocked') blocker.reset(); setLeaveFailed(false) }}>{t('common.cancel')}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ConfirmDialog
        open={confirm === 'send'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('ledgerBook.composer.send.confirmTitle')}
        description={t('ledgerBook.composer.send.confirmBody')}
        confirmLabel={t('ledgerBook.composer.send.button')}
        onConfirm={() => {
          if (sendingRef.current) return
          sendingRef.current = true
          setSending(true)
          send.mutate()
        }}
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
      {state === 'pending' && t('ledgerBook.composer.save.pending')}
      {state === 'saving' && t('ledgerBook.composer.save.saving')}
      {state === 'saved' && t('ledgerBook.composer.save.saved')}
      {state === 'failed' && t('ledgerBook.composer.save.failed')}
    </p>
  )
}
