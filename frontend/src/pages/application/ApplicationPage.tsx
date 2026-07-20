/**
 * ApplicationPage — document generation tab (TAMM vocabulary).
 *
 * Two views driven by `selectedTemplate`:
 *   - null  → Services gallery: a centered home-screen grid of emoji tiles,
 *             one per form template, with a search box above it.
 *   - set   → Form detail: a `‹ Services` back button + the picked form's
 *             emoji and title, then the existing field/preview flow.
 *
 * Picking a tile (or arriving via `?form=`) animates the form panel in with a
 * 420ms out-expo expand; the back button returns to the gallery with the same
 * motion. Both honour `prefers-reduced-motion`.
 *
 * State machine:
 *   - selectedTemplate → triggers field schema fetch
 *   - selectedEmployee → required before submission
 *   - activeTab: 'fields' | 'preview'
 *   - activeJobId → mounts <JobStatus>, switches to preview tab on generate
 *
 * Deep-link query params:
 *   - ?form=<slug> pre-selects a template (opens straight into form detail)
 *   - ?employee_id=<G-id> pre-selects an employee
 *
 * The RHF useForm instance is reset whenever the selected template changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Eye, FileText, Mail, Pencil, QrCode, RotateCcw, Search, ArrowRight, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'

import { shouldShowNotifyToggle } from './notifyToggle'
import { NotifyEmployeeToggle } from '@/components/notify/NotifyEmployeeToggle'
import { api, apiErrorMessage } from '@/lib/api'
import type { DocumentGenerateRequest, StagedAttachmentRead, TemplateMeta, WordSessionRead } from '@/lib/api'
import type { ExtractionResponse } from '@/lib/extraction'
import type { TemplateDetailResponse, TemplateField } from '@/components/application/types'
import { buildZodSchema } from '@/lib/applicationFormSchema'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TemplateForm } from '@/components/application/TemplateForm'
import { AttachmentsBlock } from '@/components/application/AttachmentsBlock'
import {
  attachmentsWithSeed,
  emptyAttachmentsState,
  filterStateToSlots,
  missingRequired,
  parseAttachmentsState,
  toGenerateSpecs,
  visibleAttachmentSlots,
} from '@/components/application/attachmentsState'
import type { AttachmentsState } from '@/components/application/attachmentsState'
import { ApiError } from '@/lib/api'
import { clearAllDrafts, clearDraft, loadDraft, saveDraft } from '@/lib/formDrafts'
import { addToBasket, basketLabel, countByFormKind, type EmailBasketItem } from '@/lib/emailBasket'
import { useEmailBasket } from '@/hooks/useEmailBasket'

import { useShortcutAction } from '@/lib/useKeyboardShortcuts'

import { EmployeeHeader } from './EmployeeHeader'
import { JobStatus } from './JobStatus'
import { emojiForTemplate, resolveTemplateIdFromSlug } from './formEmoji'
import { WordHandoffDialog } from '@/pages/books/WordHandoffDialog'

type TabValue = 'fields' | 'preview'

// Adapter: translate the api response into the shape TemplateForm expects
function adaptSchema(raw: Awaited<ReturnType<typeof api.getTemplateFields>>): TemplateDetailResponse {
  return {
    meta: raw.meta,
    needs_manager: raw.needs_manager,
    needs_submitter: raw.needs_submitter,
    fields: raw.fields as TemplateField[],
  }
}

// Field types whose components span the full form width and carry many columns;
// the form track widens to accommodate them.
const WIDE_FIELD_TYPES = new Set(['clearance_table', 'items_table', 'violation_checkboxes', 'employees_table'])

/** Pick the form-detail max-width track from the field set:
 *   - A4 ribbon (arabic_rich_full)         → max-w-5xl
 *   - table/grid forms (clearance, items…) → max-w-4xl
 *   - plain forms                          → max-w-2xl (readable measure) */
function formWidthClass(fields: readonly TemplateField[] | undefined): string {
  if (!fields) return 'mx-auto w-full max-w-2xl'
  if (fields.some((f) => f.type === 'arabic_rich_full')) return 'mx-auto w-full max-w-5xl'
  if (fields.some((f) => WIDE_FIELD_TYPES.has(f.type))) return 'mx-auto w-full max-w-4xl'
  return 'mx-auto w-full max-w-2xl'
}

export function ApplicationPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')

  // Per-template email-basket counts → the marker on each gallery tile.
  const { baskets } = useEmailBasket()
  const basketCounts = useMemo(() => countByFormKind(baskets), [baskets])

  // Router — location state carries `injectedExtraction` from the intake flow.
  const location = useLocation()
  const navigate = useNavigate()

  // Consume injected extraction once on mount; clear history state so a refresh
  // or back-navigation doesn't re-trigger the panel.
  const [pendingInjection, setPendingInjection] = useState<ExtractionResponse | undefined>(() => {
    const s = location.state as { injectedExtraction?: ExtractionResponse } | null
    return s?.injectedExtraction
  })
  // Intake scan auto-carry — the IntakePanel stages the scan and passes a token
  // in router state so ApplicationPage can seed the medical_certificate slot once
  // the form schema loads (Task 4).
  const [pendingAttachment, setPendingAttachment] = useState<
    { slotKey: string; staged: StagedAttachmentRead } | undefined
  >(() => {
    const s = location.state as {
      injectedAttachment?: { slotKey: string; staged: StagedAttachmentRead }
    } | null
    return s?.injectedAttachment
  })

  // Revise mode — the BookDetailDrawer's "Revise & regenerate" navigates here
  // with `{ reviseBookId }` in router state. Captured once on mount; we prefill
  // the originating form and thread `revise_of_book_id` into the committed save
  // so it regenerates a NEW version under the same ref.
  const [reviseBookId, setReviseBookId] = useState<number | null>(() => {
    const s = location.state as { reviseBookId?: number } | null
    return s?.reviseBookId ?? null
  })
  useEffect(() => {
    if (pendingInjection || reviseBookId !== null || pendingAttachment) {
      navigate(location.pathname + location.search, { replace: true, state: {} })
    }
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Query params — pre-seed the picker(s) on first mount.
  const [searchParams, setSearchParams] = useSearchParams()
  const formFromUrl = searchParams.get('form')
  const employeeIdFromUrl = searchParams.get('employee_id')

  // Page state
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(
    employeeIdFromUrl,
  )
  const [activeTab, setActiveTab] = useState<TabValue>('fields')
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  // Latest polled job status — drives Save book enablement on the Preview tab.
  // The Preview tab's Save button only lights up when status === 'done', so the
  // operator literally cannot save without first seeing a successful preview.
  const [previewJobStatus, setPreviewJobStatus] =
    useState<import('@/lib/api').JobStatusResponse['status'] | null>(null)
  // Whether the currently-shown preview is the committed doc (real ref) or a
  // throw-away DRAFT. Used to swap Save-book copy after a successful save so
  // we don't keep prompting "Save to commit…" when the doc *is* the committed
  // one.
  const [previewIsCommitted, setPreviewIsCommitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // General Book: classification code selected by the picker. Required for
  // every ref-allocating submit (both body modes); null only while unpicked.
  const [classificationCode, setClassificationCode] = useState<string | null>(null)
  // General Book plain-path body-mode toggle (Task 12).
  // 'editor' = HugeRTE (default); 'word' = body written in Word (no classification).
  const [bodyMode, setBodyMode] = useState<'editor' | 'word'>('editor')
  // General Book Word mode: selected boilerplate template (or null for blank).
  const [templateName, setTemplateName] = useState<string | null>(null)
  // Task 9 placeholder: after createWordBook succeeds, the session is stored here
  // so <WordHandoffDialog session={pendingWordSession} /> (Task 9) can mount and
  // guide finish/discard. The variable is read below in the TODO placeholder node.
  const [pendingWordSession, setPendingWordSession] = useState<WordSessionRead | null>(null)
  // Per-book notify opt-out — On by default; resets per form. Only surfaced for
  // the 8 notifying forms when global autosend is on (see notifyToggle.ts).
  const [notifyEmployee, setNotifyEmployee] = useState(true)
  // Draft/Save split: tracks which mode the in-flight job is in. The toast +
  // localStorage-clear in JobStatus.onDone branch on this. Stored in a ref
  // (not state) so we don't re-render the form just to flip the flag.
  const pendingCommitRef = useRef<boolean>(false)

  // Last successfully committed document — used to populate the basket item.
  const [lastSaved, setLastSaved] = useState<{ docId: number; ref: string } | null>(null)

  // Invalidate the Books ('Records') list once the generation job completes —
  // every generated form is now also a Book row (see document_service step 11b),
  // so the Records page must refresh to show it.
  const qc = useQueryClient()

  // Template list — used to (a) hydrate from ?form=, (b) show count in meta,
  // and (c) render the gallery tiles.
  const templatesQuery = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.listTemplates(),
    staleTime: Infinity,
  })
  const templates: TemplateMeta[] = useMemo(
    () => templatesQuery.data?.items ?? [],
    [templatesQuery.data],
  )

  // Once the template list is fetched, hydrate ?form= → selectedTemplate.
  // Run-once: clear ?form= after consuming to avoid re-firing on internal
  // changes.  This is the canonical URL-param-hydration pattern: we can't
  // seed `useState` because the templates query is asynchronous.
  useEffect(() => {
    if (!formFromUrl || templates.length === 0 || selectedTemplate) return
    const id = resolveTemplateIdFromSlug(formFromUrl, templates)
    if (id) {
      setSelectedTemplate(id)
    }
    // Drop ?form= from the URL but keep ?employee_id= for downstream re-mounts.
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('form')
        return next
      },
      { replace: true },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formFromUrl, templates.length])

  // Employee data for basket item — dedupes with EmployeeHeader's query.
  const employeeQuery = useQuery({
    queryKey: ['employee', selectedEmployee],
    queryFn: () => api.getEmployee(selectedEmployee as string),
    enabled: !!selectedEmployee,
    staleTime: 5 * 60 * 1000,
  })

  // Global notify setting — hides the per-book switch when notifications are
  // off app-wide. Same query key/fn as the shell (TopNav/NavDrawer) so it's cached.
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
    staleTime: 5 * 60 * 1000,
  })

  // Fetch template field schema when a template is selected
  const schemaQuery = useQuery({
    queryKey: ['template-fields', selectedTemplate],
    queryFn: () => api.getTemplateFields(selectedTemplate!),
    enabled: !!selectedTemplate,
    staleTime: Infinity,
  })
  const schema = schemaQuery.data ? adaptSchema(schemaQuery.data) : null
  const selectedMeta = templates.find((tpl) => tpl.id === selectedTemplate) ?? null

  // Attachments (spec 2026-06-11 §6) — named slots come from the template
  // policy on the detail response; the block itself renders on EVERY form
  // (no slots = just the free-form extras row). The state is page-owned so
  // it can ride the localStorage draft and the commit payload.
  const attachmentSlots = useMemo(
    () => schemaQuery.data?.attachment_slots ?? [],
    [schemaQuery.data],
  )
  const [attachmentsState, setAttachmentsState] = useState<AttachmentsState>(
    emptyAttachmentsState,
  )
  // True only after a USER attach/remove — gates the persist-on-change path so
  // programmatic resets (template switch, restore, post-save clear) can't
  // resurrect a draft that clearDraft just removed.
  const attachmentsDirtyRef = useRef(false)
  const handleAttachmentsChange = useCallback((next: AttachmentsState) => {
    attachmentsDirtyRef.current = true
    setAttachmentsState(next)
  }, [])
  // Admin-category templates (e.g. General Book) have no employee binding —
  // the backend allows employee_id=null for them, so we hide the picker entirely
  // and don't gate Generate on a selection. See document_service.generate_document.
  const isAdminCategory = selectedMeta?.category === 'admin'
  // General Book — the only form carrying the rich Arabic body editor. Its
  // classification picker is REQUIRED: every book (rich-editor or Word) takes
  // its ref from the classified register (1/{tab}/GSSG/{serial}).
  const isGeneralBookForm = !!schema?.fields.some((f) => f.type === 'arabic_rich_full')

  // Build Zod schema + RHF instance
  const zodSchema = schema ? buildZodSchema(schema.fields, t) : null

  const form = useForm({
    resolver: zodSchema ? zodResolver(zodSchema) : undefined,
    defaultValues: {},
  })

  const leaveType = form.watch('leave_type') as string | undefined
  const visibleSlots = useMemo(
    () => visibleAttachmentSlots(attachmentSlots, leaveType),
    [attachmentSlots, leaveType],
  )

  // Save-book gating: every required slot must be filled before commit.
  // Preview stays available regardless (it renders the form only).
  const missingSlotKeys = missingRequired(visibleSlots, attachmentsState)
  const firstMissingSlot =
    visibleSlots.find((s) => s.key === missingSlotKeys[0]) ?? null
  const firstMissingSlotLabel = firstMissingSlot
    ? isAr
      ? firstMissingSlot.label_ar || firstMissingSlot.label_en
      : firstMissingSlot.label_en
    : ''

  // Revise mode — fetch the originating book and prefill the form ONCE from its
  // latest version's stored field snapshot. The detail payload omits the raw
  // fields blob (only `has_fields`), so we fetch them via the dedicated endpoint.
  const reviseBookQuery = useQuery({
    queryKey: ['books', 'detail', reviseBookId],
    queryFn: () => api.getBook(reviseBookId!),
    enabled: reviseBookId !== null,
  })
  // Two-stage to avoid a race: this effect FETCHES the snapshot into state and
  // selects the template; the schema-gated effect below applies `form.reset` only
  // once the fields are actually registered. Resetting here (the instant the
  // fetch resolves) silently drops values for not-yet-mounted fields when the
  // fields-fetch beats the schema query — the same reason the localStorage
  // restore waits for `schemaReady`.
  // Select the originating template once the book loads (schemaQuery keys off it).
  useEffect(() => {
    const versions = reviseBookQuery.data?.versions ?? []
    const latest = versions[versions.length - 1]
    if (latest?.template_id) setSelectedTemplate(latest.template_id)
  }, [reviseBookQuery.data])

  // Fetch the version snapshot via a query rather than a manual fetch: under
  // React StrictMode the effect double-invokes in dev, and a manual fetch +
  // `active` cancellation silently drops the result (cleanup flips `active`
  // before the promise resolves). The query is resilient to that. It's applied
  // to the form by the schema-gated effect below, once the fields are registered.
  const reviseFieldsQuery = useQuery({
    queryKey: ['books', reviseBookId, 'revise-fields'],
    enabled: reviseBookId !== null && !!reviseBookQuery.data,
    staleTime: Infinity,
    queryFn: async (): Promise<Record<string, unknown> | null> => {
      const versions = reviseBookQuery.data?.versions ?? []
      const latest = versions[versions.length - 1]
      if (!latest) return null
      const { fields } = await api.getBookVersionFields(reviseBookId!, latest.id)
      return fields as Record<string, unknown>
    },
  })
  const reviseFields = reviseFieldsQuery.data ?? null

  // Generate mutation — drives both Preview (commit=false) and Save (commit=true).
  // The immediate POST response only carries job_id, so the actual ref number
  // (when commit=true) isn't known until JobStatus.onDone fires with the polled
  // job result. The toast + draft-clear therefore live in handleJobDone below.
  const generateMutation = useMutation({
    mutationFn: (body: DocumentGenerateRequest) => api.generateDocument(body),
    onSuccess: (resp) => {
      setActiveJobId(resp.job_id)
      // New job → preview tab is not yet "done"; the Save button on the
      // Preview tab stays disabled until JobStatus reports a successful
      // render.
      setPreviewJobStatus('queued')
      setPreviewIsCommitted(false)
      setActiveTab('preview')
      setSubmitError(null)
    },
    onError: (err) => {
      setSubmitError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err))
      toast.error(apiErrorMessage(err))
    },
  })

  // Word-session mutation — General Book Word mode: creates the book + DAV session,
  // opens Word, and shows WordHandoffDialog for finish/discard.
  const wordSessionMutation = useMutation({
    mutationFn: (body: import('@/lib/api').WordBookCreate) => api.createWordBook(body),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      // NO auto-launch: navigating to ms-word: outside a user gesture raises
      // Chrome's tab-modal protocol prompt that silently swallows every click
      // in the tab while it lingers. The handoff dialog's «Open in Word»
      // anchor is the launch point (2026-07-19 dead-buttons audit).
      setPendingWordSession(res)
    },
    onError: (err) => {
      setSubmitError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err))
      toast.error(apiErrorMessage(err))
    },
  })

  // Build the generation payload from current form values. Separated from the
  // submit handler so Preview + Save share the exact same transformation.
  const buildPayload = (
    values: Record<string, unknown>,
    commit: boolean,
  ): DocumentGenerateRequest | null => {
    if (!selectedTemplate) return null

    // Extract manager_id and submitter_id from field values
    const managerField = schema?.fields.find((f) => f.type === 'manager_picker')
    const submitterField = schema?.fields.find((f) => f.type === 'submitter_picker')

    // Separate picker values from template fields
    const managerId = managerField ? (values[managerField.id] as number | null | undefined) ?? null : null
    const submitterId = submitterField ? (values[submitterField.id] as number | null | undefined) ?? null : null

    // embed_signature: collect all `hand_sign_*` checkbox fields. Field IDs
    // remain "hand_sign_<entity>" for backwards-compat with _fields.json, but
    // Round 2 — Fix E inverted the semantics: a checked box now means
    // "embed the saved signature image". The payload key is the bare entity
    // ("employee" / "manager").
    const embedSignature: Record<string, boolean> = {}
    for (const field of schema?.fields ?? []) {
      if (field.type === 'hand_sign_checkbox') {
        const entity = field.id.replace(/^hand_sign_/, '')
        embedSignature[entity] = Boolean(values[field.id])
      }
    }

    // fields: everything except picker fields (backend resolves those separately)
    const pickerIds = new Set<string>()
    if (managerField) pickerIds.add(managerField.id)
    if (submitterField) pickerIds.add(submitterField.id)
    for (const field of schema?.fields ?? []) {
      if (field.type === 'hand_sign_checkbox') pickerIds.add(field.id)
    }
    const templateFields: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(values)) {
      // Trim short text fields on submit so trailing/leading whitespace doesn't
      // reach the DOCX token / DB. Rich-text / textarea bodies keep their
      // significant whitespace, so only trim plain strings without newlines.
      if (!pickerIds.has(k)) {
        templateFields[k] = typeof v === 'string' && !v.includes('\n') ? v.trim() : v
      }
    }

    // Attachments ride the committed save only (spec §6: preview stays
    // attachment-free). An empty list is sent as undefined so a revise with
    // untouched attachments reuses the book's existing merged set (backend
    // treats None as "keep").
    const attachmentSpecs = toGenerateSpecs(filterStateToSlots(attachmentsState, visibleSlots))

    return {
      // Admin-category forms generate unattached — see document_service.
      employee_id: isAdminCategory ? null : selectedEmployee,
      template_id: selectedTemplate,
      fields: templateFields,
      manager_id: managerId ?? undefined,
      submitter_id: submitterId ?? undefined,
      embed_signature:
        Object.keys(embedSignature).length > 0 ? embedSignature : undefined,
      commit,
      // Per-book notify opt-out — only meaningful on the committed save of a
      // notifying form; the backend ignores it otherwise.
      notify_employee: notifyEmployee,
      attachments:
        commit && attachmentSpecs.length > 0 ? attachmentSpecs : undefined,
      // Revise mode: only the committed save regenerates a new version under
      // the existing book's ref (the backend requires commit=True for it).
      revise_of_book_id: commit ? reviseBookId ?? undefined : undefined,
      // General Book: the classification drives the classified-register ref.
      classification_code: isGeneralBookForm ? classificationCode ?? undefined : undefined,
    }
  }

  const submitWithCommit = (commit: boolean) => {
    // General Book Word mode: the create needs only classification + subject —
    // it must NOT route through form.handleSubmit, whose Zod schema belongs to
    // the editor path (it validates fields Word mode never renders, and a
    // failure silently swallows the submit with no feedback near the button).
    // Every requirement is checked explicitly with a toast instead.
    if (isGeneralBookForm && bodyMode === 'word') {
      return (e?: React.BaseSyntheticEvent) => {
        e?.preventDefault()
        if (classificationCode == null) {
          toast.error(t('books.word.classificationRequired'))
          return
        }
        const values = form.getValues() as Record<string, unknown>
        const subject = typeof values['subject'] === 'string' ? values['subject'].trim() : ''
        if (!subject) {
          toast.error(t('books.word.subjectRequired'))
          return
        }
        const managerField = schema?.fields.find((f) => f.type === 'manager_picker')
        const recipientField = schema?.fields.find((f) => f.type === 'recipient_picker')
        const ccField = schema?.fields.find((f) => f.type === 'recipient_multi_picker')
        wordSessionMutation.mutate({
          classification_code: classificationCode,
          recipient_id: recipientField ? ((values[recipientField.id] as number | null | undefined) ?? null) : null,
          subject,
          cc: Array.isArray(values[ccField?.id ?? '']) ? (values[ccField!.id] as string[]) : [],
          manager_id: managerField ? ((values[managerField.id] as number | null | undefined) ?? null) : null,
          template_name: templateName ?? undefined,
        })
      }
    }

    return form.handleSubmit((values) => {
      // Personnel-category forms still require an employee; admin-category
      // ones (General Book) submit with employee_id=null. The primary button
      // is disabled in this state, but guard + surface it in case that's ever
      // bypassed so it isn't a silent no-op.
      if (!isAdminCategory && !selectedEmployee) {
        toast.error(t('application.noEmployeeSelected'))
        return
      }

      // General Book: the classification drives the ref (1/{tab}/GSSG/{serial})
      // — the editor path allocates on commit, so gate the committed submit.
      // Preview (commit=false) stays open so drafting isn't blocked.
      if (isGeneralBookForm && classificationCode == null && commit) {
        toast.error(t('books.word.classificationRequired'))
        return
      }

      const payload = buildPayload(values, commit)
      if (!payload) return
      pendingCommitRef.current = commit
      generateMutation.mutate(payload)
    })
  }

  const handlePreview = submitWithCommit(false)
  const handleSave = submitWithCommit(true)

  // JobStatus calls this with the final job payload once polling resolves.
  // Save-mode toasts the new ref + clears the draft; preview-mode is silent
  // beyond the inline PDF render. Books-list invalidation always runs so
  // Records refreshes immediately after a save (no-op for preview).
  const handleJobDone = useCallback(
    (job: import('@/lib/api').JobStatusResponse) => {
      setPreviewJobStatus(job.status)
      const primary = job.documents?.find((d) => d.role === 'primary')
      const ref = primary?.ref_number
      setPreviewIsCommitted(!!ref && ref !== 'DRAFT')
      void qc.invalidateQueries({ queryKey: ['books'] })
      if (pendingCommitRef.current && selectedTemplate) {
        if (ref && ref !== 'DRAFT') {
          toast.success(t('application.toast.saved', { ref }))
          if (primary?.document_id != null) {
            setLastSaved({ docId: primary.document_id, ref })
          }
        } else {
          toast.success(t('application.toast.generated'))
        }
        clearDraft(selectedTemplate)
        // The committed doc carries the merged attachments — clear the block
        // alongside the draft so a follow-up save can't re-send dead tokens.
        attachmentsDirtyRef.current = false
        setAttachmentsState(emptyAttachmentsState())
        // Save complete — flip the pending flag back so the Save-book hint
        // and button label reflect "this preview is the committed doc"
        // rather than "still saving".
        pendingCommitRef.current = false
        // Revise mode is one-shot: after a successful committed save the book
        // is back to approval_state="none", so threading revise_of_book_id on a
        // SECOND save would hit the BOOK_NOT_REVISABLE guard. Clear it now (only
        // for committed saves, not previews) so subsequent saves behave normally.
        if (ref && ref !== 'DRAFT') setReviseBookId(null)
      }
    },
    [qc, selectedTemplate, t],
  )

  const handleSelectTemplate = useCallback((id: string) => {
    setSelectedTemplate(id)
    // Seed from localStorage so a reload mid-draft restores the form.
    // The actual values are applied by the effect below (after the schema
    // arrives so RHF doesn't reject keys for unmounted fields).
    form.reset({})
    attachmentsDirtyRef.current = false
    setAttachmentsState(emptyAttachmentsState())
    setActiveTab('fields')
    setActiveJobId(null)
    setPreviewJobStatus(null)
    setPreviewIsCommitted(false)
    setLastSaved(null)
    // Per-book notify switch is not remembered — each newly-picked form starts On.
    setNotifyEmployee(true)
    setSubmitError(null)
    setClassificationCode(null)
    setBodyMode('editor')
    setTemplateName(null)
    setPendingWordSession(null)
  }, [form])

  // Restore the draft once the template + schema-query are in hand. Running
  // after the schema query resolves means RHF's defaultValues machinery is
  // ready and the fields are registered. Depending on schemaQuery.data
  // (not the derived ``schema`` object — that's recomputed every render and
  // would loop) keeps the effect stable.
  const schemaReady = !!schemaQuery.data

  const reviseAppliedRef = useRef(false)
  useEffect(() => {
    if (!selectedTemplate || !schemaReady) return
    // In revise mode the version snapshot is authoritative — apply it once the
    // schema is ready (fields registered) and don't fall through to a stale
    // localStorage draft. `reviseFields` is a dep so a snapshot that resolves
    // after the schema still gets applied.
    if (reviseBookId !== null) {
      if (reviseFields && !reviseAppliedRef.current) {
        form.reset(reviseFields)
        reviseAppliedRef.current = true
      }
      return
    }
    const draft = loadDraft(selectedTemplate)
    let base: AttachmentsState | null = null
    if (draft) {
      // The draft payload carries the attachments state under a reserved
      // `__attachments` key (spec §6: a refresh keeps staged tokens). Split
      // it out before resetting RHF so the form never sees the blob.
      const { __attachments, ...values } = draft
      form.reset(values)
      base = parseAttachmentsState(__attachments)
      if (base) attachmentsDirtyRef.current = false
    }
    // Seed the intake-staged scan on top of the restored draft (or onto an
    // empty state). attachmentsWithSeed is a pure function so draft content
    // is never dropped even when a pendingAttachment is present.
    const slots = schemaQuery.data?.attachment_slots ?? []
    if (base || pendingAttachment) {
      setAttachmentsState(attachmentsWithSeed(base, slots, pendingAttachment))
    }
    if (pendingAttachment) setPendingAttachment(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate, schemaReady, reviseFields])

  // Persist form values on every change, debounced. Skip when no template is
  // selected (gallery view) or when the schema hasn't loaded yet (writing
  // empty `{}` would clobber any pre-existing draft). The attachments state
  // rides the same draft blob under `__attachments` — it is a dep, so an
  // attach/remove re-runs the effect and persists the merged payload too
  // (the immediate `persist` call below covers that path; the restore effect
  // above runs first on mount, so we never save over an unread draft).
  useEffect(() => {
    if (!selectedTemplate || !schemaReady) return
    let timer: number | undefined
    const persist = (values: Record<string, unknown>): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        saveDraft(selectedTemplate, { ...values, __attachments: attachmentsState })
      }, 400)
    }
    const subscription = form.watch((values) => {
      persist(values as Record<string, unknown>)
    })
    // Attach/remove re-runs this effect (attachmentsState dep). Persist right
    // away — but only for USER changes, so the post-save programmatic clear
    // doesn't write a fresh draft over the one clearDraft just removed.
    if (attachmentsDirtyRef.current) {
      persist(form.getValues() as Record<string, unknown>)
    }
    return () => {
      window.clearTimeout(timer)
      subscription.unsubscribe()
    }
  }, [selectedTemplate, schemaReady, form, attachmentsState])

  // Leaving the Services page discards in-progress form autosaves so a returning
  // visit starts fresh (no stale typed-but-unsaved input). Explicitly-saved drafts
  // live in Records (DB), not localStorage, so they're unaffected. The deferred
  // flag skips React 18 StrictMode's throwaway-mount cleanup, which would
  // otherwise wipe a draft the restore effect just applied.
  useEffect(() => {
    let armed = false
    const id = window.setTimeout(() => {
      armed = true
    }, 0)
    return () => {
      window.clearTimeout(id)
      if (armed) clearAllDrafts()
    }
  }, [])

  const handleSelectEmployee = useCallback((id: string | null) => {
    setSelectedEmployee(id)
  }, [])

  // Clear the picked form and return to the gallery. Shared by the back
  // button and the Ctrl+N "new form" shortcut so the two paths can't drift.
  const resetToGallery = useCallback(() => {
    form.reset({})
    setSelectedTemplate(null)
    attachmentsDirtyRef.current = false
    setAttachmentsState(emptyAttachmentsState())
    setActiveJobId(null)
    setPreviewJobStatus(null)
    setPreviewIsCommitted(false)
    setLastSaved(null)
    // Per-book notify switch is not remembered — reset to On when clearing.
    setNotifyEmployee(true)
    setActiveTab('fields')
    setSubmitError(null)
    setClassificationCode(null)
    setBodyMode('editor')
    setTemplateName(null)
    setPendingWordSession(null)
  }, [form])

  // Ctrl+N — clear and pick again from the gallery.
  useShortcutAction('newItem', resetToGallery)

  const previewTabLabel = t('application.tabs.preview')
  const selectedTemplateName = selectedMeta
    ? isAr
      ? selectedMeta.name_ar
      : selectedMeta.name_en
    : ''

  // Gallery filter — match on either language's name or the canonical id.
  const galleryItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return templates
    return templates.filter(
      (tpl) =>
        tpl.name_en.toLowerCase().includes(q) ||
        tpl.name_ar.toLowerCase().includes(q) ||
        tpl.id.toLowerCase().includes(q),
    )
  }, [templates, query])

  // National Service synthetic tile — record shortcut (no DOCX form).
  const nsTitle = t('leaves.type.National Service')
  const nsMatchesQuery =
    !query.trim() || nsTitle.toLowerCase().includes(query.trim().toLowerCase())

  // Duty Locations synthetic tile — generates a General Book transfer letter.
  const dlTitle = t('dutyLocations.tile.name')
  const dlMatchesQuery =
    !query.trim() || dlTitle.toLowerCase().includes(query.trim().toLowerCase())

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      {/* Word handoff dialog — shown after createWordBook; unmounts when session is cleared */}
      <WordHandoffDialog
        session={pendingWordSession}
        open={pendingWordSession != null}
        onClose={() => setPendingWordSession(null)}
      />
      <div className="mx-auto w-full max-w-[1320px] flex-1 px-4 pb-10 pt-6 sm:px-8">
        {selectedTemplate === null ? (
          /* ───────────────── Services gallery ───────────────── */
          <div className="anim-fade-up" key="gallery">
            <header className="mb-5">
              <div className="text-[0.75em] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {t('application.eyebrow')}
              </div>
              <h2 className="mt-1 text-[1.7em] font-bold tracking-tight text-foreground">
                {t('application.servicesTitle')}
              </h2>
              <div className="mt-1 text-[0.86em] text-muted-foreground">
                {t('application.meta', { count: templates.length })}
              </div>
            </header>

            <div className="w-full">
              {/* Search */}
              <label className="mb-6 flex items-center gap-2.5 rounded-2xl bg-surface px-4 py-2.5 ring-1 ring-hairline focus-within:ring-2 focus-within:ring-primary">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('application.searchServices')}
                  aria-label={t('application.searchServices')}
                  className="w-full bg-transparent text-[0.92em] text-foreground outline-none placeholder:text-faint"
                />
              </label>

              {/* Grid / loading / empty — full-width card rail per the design
                  system (components-service-tile.html): 2/3/4 columns that fill
                  the available width, equal-height rows, descriptive sub-line. */}
              {templatesQuery.isError ? (
                <p className="py-12 text-center text-[0.86em] text-accent">
                  {t('application.pickerLoadError')}
                </p>
              ) : templatesQuery.isLoading ? (
                <div className="grid grid-cols-2 gap-3 [grid-auto-rows:1fr] sm:grid-cols-3 lg:grid-cols-4">
                  {Array.from({ length: 16 }).map((_, i) => (
                    <Skeleton key={i} className="h-[120px] w-full rounded-2xl" />
                  ))}
                </div>
              ) : galleryItems.length === 0 && !nsMatchesQuery && !dlMatchesQuery ? (
                <p className="py-12 text-center text-[0.86em] text-muted-foreground">
                  {t('application.noServicesMatch')}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 [grid-auto-rows:1fr] sm:grid-cols-3 lg:grid-cols-4">
                  {nsMatchesQuery && (
                    <ServiceCell
                      key="national-service-record"
                      name={nsTitle}
                      category={t('application.nsCategory')}
                      emoji="🎖️"
                      onSelect={() => navigate('/leaves?ns=new')}
                    />
                  )}
                  {dlMatchesQuery && (
                    <ServiceCell
                      key="duty-locations"
                      name={dlTitle}
                      category={t('dutyLocations.tile.category')}
                      emoji="🚚"
                      onSelect={() => navigate('/duty-locations')}
                    />
                  )}
                  {galleryItems.map((tpl) => (
                    <ServiceCell
                      key={tpl.id}
                      name={isAr ? tpl.name_ar : tpl.name_en}
                      category={t(`application.formList.${tpl.category}`)}
                      emoji={emojiForTemplate(tpl.id)}
                      basketCount={basketCounts[tpl.id] ?? 0}
                      hasCode={tpl.has_code}
                      onSelect={() => handleSelectTemplate(tpl.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ───────────────── Form detail ───────────────── */
          <div className="anim-fade-up" key="form">
            <header className="mb-5">
              <button
                type="button"
                onClick={resetToGallery}
                className="mb-2.5 inline-flex items-center gap-1.5 text-[0.86em] font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {isAr ? (
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                ) : (
                  <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                )}
                {t('application.servicesTitle')}
              </button>
              <div className="flex items-center gap-3">
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface text-[1.5em] leading-none ring-1 ring-hairline"
                  aria-hidden
                >
                  {emojiForTemplate(selectedTemplate)}
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-[1.4em] font-bold leading-snug tracking-tight text-foreground">
                    {selectedTemplateName || t('application.formCard.fallbackTitle')}
                  </h2>
                  <p className="mt-0.5 text-[0.82em] text-muted-foreground">
                    {t('application.formCard.description')}
                  </p>
                </div>
              </div>
            </header>

            <section className="rounded-2xl bg-surface px-4 py-6 sm:px-7">
              {/* Tab strip — Fields / Preview */}
              <div className="mb-5 flex items-center gap-1 border-b border-hairline pb-4">
                <TabButton
                  active={activeTab === 'fields'}
                  onClick={() => setActiveTab('fields')}
                >
                  {t('application.tabs.fields')}
                </TabButton>
                <TabButton
                  active={activeTab === 'preview'}
                  onClick={() => setActiveTab('preview')}
                  disabled={!activeJobId}
                >
                  {previewTabLabel}
                </TabButton>

                {/* Preview-only actions on the right of the tab strip */}
                {activeTab === 'preview' && activeJobId && (
                  <div className="ms-auto flex items-center gap-2">
                    <PreviewActions
                      onEditFields={() => setActiveTab('fields')}
                      onNewForm={() => {
                        form.reset({})
                        setActiveJobId(null)
                        setActiveTab('fields')
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Tab content */}
              {activeTab === 'fields' && (
                <div
                  className={
                    // General Book and other forms with the full Word-like
                    // ribbon need an A4-width canvas. Table/grid-heavy forms
                    // (clearance, items, violation checkboxes) need room for
                    // their many columns. Plain forms stay at a tight,
                    // readable measure.
                    formWidthClass(schema?.fields)
                  }
                >
                  {!isAdminCategory && (
                    <>
                      <EmployeeHeader
                        selectedId={selectedEmployee}
                        onSelect={handleSelectEmployee}
                      />

                      {!selectedEmployee && (
                        <div className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[0.78em] text-warning">
                          {t('application.noEmployeeSelected')}
                        </div>
                      )}
                    </>
                  )}

                  {submitError && (
                    <div
                      role="alert"
                      className="mb-4 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-[0.78em] text-accent"
                    >
                      {submitError}
                    </div>
                  )}

                  {schemaQuery.isLoading && (
                    <p className="text-[0.78em] text-muted-foreground">{t('common.loading')}</p>
                  )}

                  {schema && (
                    // Default submit (Enter) maps to Preview — the safer
                    // action. Save requires an explicit click on the primary
                    // button so the ref isn't allocated by accident.
                    <form onSubmit={handlePreview} noValidate>
                      <TemplateForm
                        templateId={selectedTemplate}
                        schema={schema}
                        form={form}
                        employeeId={selectedEmployee}
                        initialExtraction={pendingInjection}
                        onExtractionConsumed={() => setPendingInjection(undefined)}
                        classificationCode={classificationCode}
                        onClassificationChange={setClassificationCode}
                        bodyMode={bodyMode}
                        onBodyModeChange={(mode) => {
                          setBodyMode(mode)
                          if (mode !== 'word') setTemplateName(null)
                        }}
                        templateName={templateName}
                        onTemplateNameChange={setTemplateName}
                      />

                      {/* Attachments — named slots from the form policy plus
                          free-form extras, on EVERY form (spec 2026-06-11 §6).
                          Required slots gate Save book (not Preview). */}
                      <AttachmentsBlock
                        slots={visibleSlots}
                        state={attachmentsState}
                        onChange={handleAttachmentsChange}
                      />

                      {/* Action row: Word mode → "Create & open in Word"; normal → Preview. */}
                      <div className="mt-7 flex flex-wrap items-center justify-between gap-2.5 border-t border-hairline pt-4">
                        {isGeneralBookForm && bodyMode === 'word' ? (
                          // Word mode — single action: create the book and open it in Word.
                          // Word-brand blue (#185abd) is reserved for open-in-Word actions.
                          <>
                            <p className="text-[0.78em] text-muted-foreground">
                              {t('books.word.bodyInWord')}
                            </p>
                            <Button
                              type="submit"
                              size="commit"
                              disabled={
                                (!isAdminCategory && !selectedEmployee) ||
                                wordSessionMutation.isPending
                              }
                              className="min-h-11 disabled:cursor-not-allowed disabled:opacity-50"
                              style={{ backgroundColor: '#185abd', color: '#fff' }}
                            >
                              {wordSessionMutation.isPending
                                ? t('common.loading')
                                : t('books.word.createAndOpen')}
                              {isAr ? (
                                <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                              ) : (
                                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                              )}
                            </Button>
                          </>
                        ) : (
                          // Normal mode — Preview then Save flow.
                          <>
                            <p className="text-[0.78em] text-muted-foreground">
                              {t('application.previewFirstHint')}
                            </p>
                            <Button
                              type="submit"
                              variant="commit"
                              size="commit"
                              disabled={
                                (!isAdminCategory && !selectedEmployee) || generateMutation.isPending
                              }
                              className="min-h-11 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Eye className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                              {generateMutation.isPending && !pendingCommitRef.current
                                ? t('common.loading')
                                : t('application.actions.preview')}
                              {isAr ? (
                                <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                              ) : (
                                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                              )}
                            </Button>
                          </>
                        )}
                      </div>
                    </form>
                  )}
                </div>
              )}

              {activeTab === 'preview' && activeJobId && (
                <div className="flex min-h-[400px] flex-col">
                  <JobStatus key={activeJobId} jobId={activeJobId} onDone={handleJobDone} />

                  {shouldShowNotifyToggle(
                    selectedTemplate,
                    settingsQuery.data?.sms_autosend_enabled ?? false,
                  ) && (
                    <NotifyEmployeeToggle
                      className="mt-4"
                      checked={notifyEmployee}
                      onChange={setNotifyEmployee}
                      label={t('application.notify.label')}
                      hint={
                        notifyEmployee
                          ? t('application.notify.hintOn')
                          : t('application.notify.hintOff')
                      }
                    />
                  )}

                  {/* Save book lives here — only enabled when the preview job
                      reports `done`. While the job is queued/running the
                      button stays disabled with a "Waiting for preview…"
                      label so the gate is visible, not just implicit.
                      Once the visible preview IS the committed doc (real ref),
                      we swap copy to "Saved" and disable the button to prevent
                      a double-commit. */}
                  <div className="mt-6 flex flex-wrap items-center justify-between gap-2.5 border-t border-hairline pt-4">
                    <p className="text-[0.78em] text-muted-foreground">
                      {previewIsCommitted
                        ? t('application.savedHint')
                        : missingSlotKeys.length > 0
                          ? t('application.attachments.requiredHint', {
                              slot: firstMissingSlotLabel,
                            })
                          : previewJobStatus === 'done'
                            ? t('application.saveReadyHint')
                            : t('application.saveBookHint')}
                    </p>
                    <div className="flex items-center gap-2">
                      {lastSaved && selectedTemplate && employeeQuery.data && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={async () => {
                            let bookId: number
                            try {
                              const book = await api.getBookByRef(lastSaved.ref)
                              bookId = book.id
                            } catch {
                              toast.error(t('basket.addError'))
                              return
                            }
                            const v = form.getValues()
                            const leaveType =
                              typeof v.leave_type === 'string'
                                ? v.leave_type.split(' ')[0]
                                : undefined
                            const detail =
                              v.start_date && v.end_date
                                ? `${String(v.start_date)} → ${String(v.end_date)}`
                                : selectedTemplate
                            const item: EmailBasketItem = {
                              bookId,
                              docId: lastSaved.docId,
                              ref: lastSaved.ref,
                              employeeId: selectedEmployee as string,
                              nameEn: employeeQuery.data.name_en ?? '',
                              nameAr: employeeQuery.data.name_ar ?? null,
                              formKind: selectedTemplate,
                              leaveType:
                                selectedTemplate === 'Leave Application Form'
                                  ? leaveType
                                  : undefined,
                              detail,
                            }
                            const { added, key } = addToBasket(item)
                            const kind = basketLabel(key, (k: string) => t(k))
                            if (added) {
                              toast.success(t('basket.tray.added', { kind }))
                            } else {
                              toast(t('basket.tray.alreadyIn', { kind }))
                            }
                          }}
                        >
                          {t('basket.add')}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="commit"
                        size="commit"
                        onClick={() => void handleSave()}
                        disabled={
                          (!isAdminCategory && !selectedEmployee) ||
                          generateMutation.isPending ||
                          previewJobStatus !== 'done' ||
                          previewIsCommitted ||
                          missingSlotKeys.length > 0
                        }
                        className="min-h-11 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <FileText className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                        {generateMutation.isPending && pendingCommitRef.current
                          ? t('common.loading')
                          : previewIsCommitted
                            ? t('application.actions.saved')
                            : previewJobStatus === 'done'
                              ? t('application.actions.saveBook')
                              : t('application.actions.waitingForPreview')}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** One service card in the Services gallery.
 *
 * Mirrors the design-system service tile (components-service-tile.html):
 * left-aligned card, 4px primary top accent, emoji → title → category
 * sub-line, equal-height rows (parent grid uses `grid-auto-rows: 1fr`). */
function ServiceCell({
  name,
  category,
  emoji,
  basketCount,
  hasCode,
  onSelect,
}: {
  name: string
  category: string
  emoji: string
  basketCount?: number
  /** Whether the generated form carries a scannable ref code. Omit on synthetic
   *  tiles (National Service / Duty Locations) that aren't standard forms. */
  hasCode?: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group relative flex h-full min-h-[120px] w-full flex-col items-start rounded-2xl border-t-4 border-primary bg-surface p-4 text-start shadow-sm ring-1 ring-hairline transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-1 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {hasCode !== undefined && <CodeBadge hasCode={hasCode} />}
      <span
        className="block text-[1.6em] leading-none transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-[3px]"
        aria-hidden
      >
        {emoji}
      </span>
      <span className="mt-2.5 line-clamp-2 pb-0.5 text-[0.84em] font-semibold leading-snug text-foreground">
        {name}
      </span>
      <span className="mt-auto flex w-full items-center gap-2.5 pt-1.5">
        {basketCount !== undefined && <BasketMarker count={basketCount} />}
        <span className="min-w-0 truncate text-[0.68em] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          {category}
        </span>
      </span>
    </button>
  )
}

/** Code badge pinned to a service tile's top-inside corner. A solid primary chip
 *  means the generated form carries a scannable ref code; a muted, slashed chip
 *  marks any form that can't (none today, but kept for future forms with no
 *  clear corner), so "does this scan back deterministically?" reads at a glance. */
function CodeBadge({ hasCode }: { hasCode: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const label = hasCode ? t('application.code.has') : t('application.code.none')
  return (
    <span
      title={label}
      className={[
        'absolute top-2.5 end-2.5 grid h-[22px] w-[22px] place-items-center rounded-md',
        hasCode ? 'bg-primary-soft text-primary' : 'bg-surface-tinted text-faint',
      ].join(' ')}
    >
      <QrCode className="h-[13px] w-[13px]" strokeWidth={1.8} aria-hidden />
      {!hasCode && (
        // Diagonal strike — the unambiguous "no QR" signal. Direction-agnostic,
        // so it reads the same in LTR and RTL.
        <span
          aria-hidden
          className="absolute h-[1.5px] w-[17px] -rotate-45 rounded-full bg-muted-foreground/70"
        />
      )}
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** Email-basket marker on a service tile's bottom row. Faint envelope when the
 *  basket is empty (signals "can collect"); envelope + crimson count when docs
 *  are waiting to be emailed. */
function BasketMarker({ count }: { count: number }): React.JSX.Element {
  const { t } = useTranslation()
  const pending = count > 0
  return (
    <span
      title={pending ? t('basket.tile.pending', { count }) : t('basket.tile.empty')}
      className={[
        'relative inline-flex shrink-0 leading-none transition-colors',
        pending
          ? 'text-muted-foreground group-hover:text-foreground'
          : 'text-faint group-hover:text-muted-foreground',
      ].join(' ')}
    >
      <Mail className="h-[15px] w-[15px]" strokeWidth={1.8} aria-hidden />
      {pending && (
        <>
          <span
            aria-hidden
            className="absolute -top-[7px] end-[-6px] grid h-[15px] min-w-[15px] place-items-center rounded-full border-2 border-surface bg-accent px-1 text-[9px] font-bold leading-none tabular-nums text-white shadow-sm motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:duration-200"
          >
            {count}
          </span>
          {/* The empty envelope is decorative; only the pending count is
              meaningful state, so expose it (not the title) to screen readers. */}
          <span className="sr-only">{t('basket.tile.pending', { count })}</span>
        </>
      )}
    </span>
  )
}

function TabButton({
  children,
  active,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        'relative inline-flex items-center rounded-full px-3.5 py-1.5 text-[0.78em] font-medium transition-colors',
        active
          ? 'bg-primary-soft text-primary'
          : 'text-muted-foreground hover:bg-surface-tinted hover:text-foreground',
        disabled ? 'cursor-not-allowed opacity-40' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </button>
  )
}

function PreviewActions({
  onEditFields,
  onNewForm,
}: {
  onEditFields: () => void
  onNewForm: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      <button
        type="button"
        onClick={onEditFields}
        className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1.5 text-[0.78em] font-medium text-muted-foreground hover:bg-surface-tinted hover:text-foreground"
      >
        <Pencil className="h-3 w-3" />
        {t('application.editFields')}
      </button>
      <button
        type="button"
        onClick={onNewForm}
        className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1.5 text-[0.78em] font-medium text-muted-foreground hover:bg-surface-tinted hover:text-foreground"
      >
        <RotateCcw className="h-3 w-3" />
        {t('application.newForm')}
      </button>
    </>
  )
}
