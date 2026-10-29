/**
 * ApplicationPage — document generation tab (TAMM vocabulary).
 *
 * Two views driven by `selectedTemplate`:
 *   - null  → Services gallery: a centered home-screen grid of emoji tiles,
 *             one per form template, with a search box above it.
 *   - set   → Form detail: a `‹ Services` back button + the picked form's
 *             emoji and title, then the existing field/preview flow.
 *
 * Picking a tile (or arriving at `/services/<slug>`) animates the form panel in with a
 * 420ms out-expo expand; the back button returns to the gallery with the same
 * motion. Both honour `prefers-reduced-motion`.
 *
 * State machine:
 *   - selectedTemplate → triggers field schema fetch
 *   - selectedEmployee → required before submission
 *   - activeTab: fields | preview | notification | email-draft (URL-backed)
 *   - activeJobId → mounts <JobStatus>, switches to preview tab on generate
 *
 * URL (the source of truth for which service is open):
 *   - /services            → gallery; ?q= is the search box
 *   - /services/<slug>     → that service's form (push, so Back returns to the gallery)
 *   - ?employee_id=<G-id>  pre-selects an employee
 *   - ?tab=notification|email-draft → service template editor
 *   - ?revise=<bookId>     revise mode (regenerates a new version of that book)
 *   - ?mode=stats&stats_month=YYYY-MM → inmate violations monthly register
 *   - ?mode=upload → Inmate Conduct Violations opens on "import a signed paper violation"
 *   - ?group=<id> → gallery opened inside that service folder (see serviceGroups.ts)
 *
 * The RHF useForm instance is reset whenever the selected template changes.
 */

import { ACTIVITY_STATEMENT_QUERY } from '@/pages/employees/statement/statementModel'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Eye, Mail, Pencil, QrCode, RotateCcw, Search, ArrowRight, ArrowLeft } from 'lucide-react'
import { toast } from '@/lib/toast'

import { shouldShowNotifyToggle } from './notifyToggle'
import { GeneratedSaveActions } from './GeneratedSaveActions'
import { savedGenerationFromJob, type SavedGeneration } from './savedGeneration'
import { ApprovedViolationUpload } from './ApprovedViolationUpload'
import { InmateViolationGroupPicker } from './InmateViolationGroupPicker'
import { StatisticsTab } from './statistics/StatisticsTab'
import { InmateReporterApplication } from './InmateReporterApplication'
import { SavedRecordActions, type NotificationChoice } from '@/components/books/SavedRecordActions'
import { GradeSelect } from '@/components/books/GradeSelect'
import { api, apiErrorMessage } from '@/lib/api'
import { AuthContext } from '@/lib/authContext'
import type {
  ApprovedViolationImportRead,
  Grade,
  DocumentGenerateRequest,
  JobStatusResponse,
  StagedAttachmentRead,
  TemplateMeta,
  WordBookCreate,
} from '@/lib/api'
import type { ExtractionResponse } from '@/lib/extraction'
import type { TemplateDetailResponse, TemplateField } from '@/components/application/types'
import { buildZodSchema } from '@/lib/applicationFormSchema'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ServiceArtwork, type ServiceArtworkId } from '@/components/ui/service-artwork'
import { TemplateForm } from '@/components/application/TemplateForm'
import { AttachmentsBlock } from '@/components/application/AttachmentsBlock'
import { ServiceNotificationTab } from '@/components/templates/ServiceNotificationTab'
import { ServiceDraftTab } from '@/components/templates/ServiceDraftTab'
import { useMessageTemplates } from '@/lib/messageTemplates'
import { draftKeysForService, useDraftVariants } from '@/lib/draftTemplates'
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
import { isQuickActionAllowed } from '@/lib/dashboardLayout'
import { useCapabilities } from '@/lib/useCapabilities'

import { useShortcutAction } from '@/lib/useKeyboardShortcuts'

import { EmployeeHeader } from './EmployeeHeader'
import { JobStatus } from './JobStatus'
import {
  artworkForTemplate,
  emojiForTemplate,
  resolveTemplateIdFromSlug,
} from './formEmoji'
import { useSearchParam } from '@/lib/urlState'
import { serviceHref } from '@/lib/quickActions'
import {
  DUTY_LOCATIONS_ID,
  EMPLOYEE_ABSENCE_ID,
  INMATE_IMPORT_SIGNED_ID,
  INMATE_MONTHLY_STATS_ID,
  NATIONAL_SERVICE_ID,
  OTHER_GROUP_ICON,
  OTHER_GROUP_ID,
  SERVICE_GROUPS,
} from './serviceGroups'
import {
  nowHM,
  restoreThenSeedResignationDate,
  seedReportDateTime,
  todayIso,
} from './resignationDate'

type InmateEntryMode = 'create' | 'upload' | 'stats'

/** One openable tile of the Services gallery (a template form or a shortcut). */
interface GalleryTile {
  id: string
  name: string
  /** Lower-cased on match; template tiles match either language and the id. */
  searchText: string
  category: string
  emoji: string
  artwork?: ServiceArtworkId
  basketCount?: number
  hasCode?: boolean
  onSelect: () => void
}

/** Services printed on an English or an Arabic paper: one gallery tile, and a
 *  language tab in the form choosing which backend form kind is generated. */
const PAPER_LANGUAGES = [
  { en: 'Material Request Form', ar: 'Material Request Form (Arabic)' },
] as const

/** Segmented tab: the shared underline trigger reshaped into a pill (as on Permits). */
const paperTabCls =
  'mb-0 h-11 rounded-md border-0 px-4 focus-visible:ring-offset-0 motion-reduce:transition-none md:h-8 md:text-[0.86em] ' +
  'data-[state=inactive]:hover:bg-surface/60 ' +
  'data-[state=active]:bg-surface data-[state=active]:font-semibold data-[state=active]:text-primary data-[state=active]:shadow-sm ' +
  '[[data-theme=dark]_&]:data-[state=active]:bg-surface-tinted [[data-theme=dark]_&]:data-[state=active]:text-foreground [[data-theme=dark]_&]:data-[state=active]:shadow-none'

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
const WIDE_FIELD_TYPES = new Set([
  'clearance_table',
  'items_table',
  'violation_checkboxes',
  'employees_table',
  'inmates_table',
])

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
  const auth = useContext(AuthContext)
  return auth?.user?.role === 'inmate_reporter'
    ? <InmateReporterApplication user={auth.user} />
    : <StandardApplicationPage />
}

function StandardApplicationPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const { has, isLoading: capabilitiesLoading } = useCapabilities()

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

  // Revise mode — "Revise & regenerate" links to `/services/<slug>?revise=<id>`.
  // We prefill the originating form and thread `revise_of_book_id` into the
  // committed save so it regenerates a NEW version under the same ref. The API
  // authorizes the book; the URL only selects it.
  const [reviseParam, setReviseParam] = useSearchParam('revise')
  const reviseBookId = /^\d+$/.test(reviseParam) ? Number(reviseParam) : null
  useEffect(() => {
    if (pendingInjection || pendingAttachment) {
      navigate(location.pathname + location.search, { replace: true, state: {} })
    }
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { slug } = useParams<{ slug?: string }>()
  const [searchParams] = useSearchParams()
  const employeeIdFromUrl = searchParams.get('employee_id')

  // Page state
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(
    employeeIdFromUrl,
  )
  const [requestedTab, setActiveTab] = useSearchParam('tab', { fallback: 'fields' })
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  // Latest polled job status — drives Save book enablement on the Preview tab.
  // The Preview tab's Save button only lights up when status === 'done', so the
  // operator literally cannot save without first seeing a successful preview.
  const [previewJobStatus, setPreviewJobStatus] =
    useState<JobStatusResponse['status'] | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [query, setQuery] = useSearchParam('q')
  // Folder currently open in the gallery (no value = the folder grid). Pushed so Back
  // from a service returns to the folder the user came from.
  const [groupId, setGroupId] = useSearchParam('group', { push: true })
  // General Book: classification code selected by the picker. Required for
  // every ref-allocating submit (both body modes); null only while unpicked.
  const [classificationCode, setClassificationCode] = useState<string | null>(null)
  // Record grade (unclassified/secret/top_secret/addressee_only) picked at creation; a revision keeps the
  // book's grade, so revise mode neither shows nor sends it.
  const [grade, setGrade] = useState<Grade>('unclassified')
  // General Book plain-path body-mode toggle (M5-1: editor hidden, word-only).
  // 'word' = body written in Word; kept typed so revert is one char change.
  const [bodyMode, setBodyMode] = useState<'editor' | 'word'>('word')
  // General Book Word mode: selected boilerplate template (or null for blank).
  const [templateName, setTemplateName] = useState<string | null>(null)
  // Per-book notify opt-out — On by default; resets per form. Only surfaced for
  // the 8 notifying forms when global autosend is on (see notifyToggle.ts).
  const [notifyEmployee, setNotifyEmployee] = useState(true)
  // Draft/Save split: tracks which mode the in-flight job is in. The toast +
  // localStorage-clear in JobStatus.onDone branch on this. Stored in a ref
  // (not state) so we don't re-render the form just to flip the flag.
  const pendingCommitRef = useRef<boolean>(false)
  const pendingCommitToastRef = useRef<string | number | undefined>(undefined)
  const pendingNotificationRef = useRef<NotificationChoice | undefined>(undefined)

  // Last successfully committed document — used to populate the basket item.
  const [lastSaved, setLastSaved] = useState<
    (SavedGeneration & { notification?: NotificationChoice }) | null
  >(null)
  const requestedInmateMode: 'stats' | 'upload' | null =
    slug === 'inmate_conduct_violations' &&
    (searchParams.get('mode') === 'stats' || searchParams.get('mode') === 'upload')
      ? (searchParams.get('mode') as 'stats' | 'upload')
      : null
  const hydratedStatsNavigationRef = useRef<string | null>(null)
  const [inmateEntryMode, setInmateEntryMode] = useState<InmateEntryMode>('create')
  const [approvedImport, setApprovedImport] = useState<ApprovedViolationImportRead | null>(null)
  const [approvedImportBusy, setApprovedImportBusy] = useState(false)
  const approvedImportSuccessRef = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    if (approvedImport?.book_id) approvedImportSuccessRef.current?.focus()
  }, [approvedImport?.book_id])

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
  const allTemplates: TemplateMeta[] = useMemo(
    () => templatesQuery.data?.items ?? [],
    [templatesQuery.data],
  )
  const templates = useMemo(
    () =>
      allTemplates.filter(
        (template) =>
          !template.feature_minted && isQuickActionAllowed(template.id, has),
      ),
    [allTemplates, has],
  )

  // Employee data for basket item — dedupes with EmployeeHeader's query.
  const employeeQuery = useQuery({
    queryKey: ['employee-lookup', selectedEmployee],
    queryFn: () => api.getEmployeeLookup(selectedEmployee as string),
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
  const messageTemplates = useMessageTemplates()
  const draftVariants = useDraftVariants()
  const hasNotificationTab = selectedTemplate !== null && (
    messageTemplates.data?.some((template) => template.services.includes(selectedTemplate)) ||
    selectedMeta?.notifies_employee === true
  )
  const hasDraftTab = selectedTemplate !== null &&
    draftKeysForService(draftVariants, selectedTemplate).length > 0
  const activeTab =
    (requestedTab === 'notification' && hasNotificationTab) ||
    (requestedTab === 'email-draft' && hasDraftTab) ||
    (requestedTab === 'preview' && activeJobId)
      ? requestedTab
      : 'fields'

  // The loading notice belongs to the mounted preview's job monitoring.
  // Leaving the preview, replacing its job, or leaving this page abandons it.
  useEffect(() => {
    if (activeTab !== 'preview' || !activeJobId || !pendingCommitRef.current) return
    const id = toast.loading(t('application.toast.saving'))
    pendingCommitToastRef.current = id
    return () => {
      if (pendingCommitToastRef.current !== id) return
      toast.dismiss(id)
      pendingCommitToastRef.current = undefined
    }
  }, [activeJobId, activeTab, t])
  const paperPair =
    PAPER_LANGUAGES.find((p) => p.en === selectedTemplate || p.ar === selectedTemplate) ?? null
  // The tab needs both papers allowed; a revision stays on its book's paper.
  const paperChoice =
    paperPair &&
    reviseBookId === null &&
    templates.some((tpl) => tpl.id === paperPair.en) &&
    templates.some((tpl) => tpl.id === paperPair.ar)
      ? paperPair
      : null
  const notifyContext = {
    notifiesEmployee: selectedMeta?.notifies_employee ?? false,
    autosendEnabled: settingsQuery.data?.sms_autosend_enabled ?? false,
    isRevision: reviseBookId !== null,
  }
  const showNotifyEmployee = shouldShowNotifyToggle(notifyContext)
  const showNotifyPreview = shouldShowNotifyToggle({ ...notifyContext, isRevision: false })

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
  const isInmateService = selectedTemplate === 'Inmate Conduct Violations'
  // General Book — the only form carrying the rich Arabic body editor. Its
  // classification picker is REQUIRED: every book (rich-editor or Word) takes
  // its ref from the classified register (1/{tab}/GSSG/{serial}).
  const isGeneralBookForm = !!schema?.fields.some((f) => f.type === 'arabic_rich_full') && selectedTemplate !== 'Report'
  // Report: body authored in Word, with finish/discard on the Word session page.
  const isReportForm = selectedTemplate === 'Report'

  // Build Zod schema + RHF instance
  const zodSchema = schema ? buildZodSchema(schema.fields, t) : null

  const form = useForm({
    resolver: zodSchema ? zodResolver(zodSchema) : undefined,
    defaultValues: {},
  })

  const currentFormValues = form.watch()
  const leaveType = currentFormValues.leave_type as string | undefined
  const visibleSlots = useMemo(
    () => visibleAttachmentSlots(attachmentSlots, leaveType),
    [attachmentSlots, leaveType],
  )

  // Save-book gating: every required slot must be filled before commit.
  // Preview stays available regardless and includes every attachment supplied.
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
  // Two-stage to avoid a race: the snapshot is fetched here; the schema-gated
  // effect below applies `form.reset` only once the fields are actually
  // registered. Resetting the instant the fetch resolves silently drops values
  // for not-yet-mounted fields when the fields-fetch beats the schema query —
  // the same reason the localStorage restore waits for `schemaReady`.
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
  // The POST only carries job_id; the saved reference arrives via JobStatus.
  // The mounted preview owns the save notice; handleJobDone resolves it.
  const generateMutation = useMutation({
    mutationFn: (body: DocumentGenerateRequest) => api.generateDocument(body),
    onSuccess: (resp) => {
      setActiveJobId(resp.job_id)
      // New job → preview tab is not yet "done"; the Save button on the
      // Preview tab stays disabled until JobStatus reports a successful
      // render.
      setPreviewJobStatus('queued')
      setLastSaved(null)
      setActiveTab('preview')
      setSubmitError(null)
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'LEAVE_ALREADY_ISSUED') {
        const ref = String(err.details.ref_number ?? '')
        const message = t('application.leaveAlreadyIssuedNoRef')
        setSubmitError(message)
        toast.error(message, { reference: ref })
        return
      }
      setSubmitError(apiErrorMessage(err))
      toast.error(apiErrorMessage(err))
    },
  })

  // Create the book + DAV session, then show the Word session page.
  const wordSessionMutation = useMutation({
    mutationFn: (body: WordBookCreate) => api.createWordBook(body),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      // Clear the draft now the book exists — the body lives in Word from here,
      // so a stale localStorage draft only resurrects last time's values on the
      // next book. Critically it stops a once-unticked Report "توقيع الآن"
      // (sign=false) from persisting and silently defaulting every later report
      // to unsigned. Mirrors the non-word path (handleJobDone → clearDraft).
      if (selectedTemplate) clearDraft(selectedTemplate)
      attachmentsDirtyRef.current = false
      setAttachmentsState(emptyAttachmentsState())
      // NO auto-launch: navigating to ms-word: outside a user gesture raises
      // Chrome's tab-modal protocol prompt that silently swallows every click
      // in the tab while it lingers. The Word page's «Open in Word»
      // anchor is the launch point (2026-07-19 dead-buttons audit).
      navigate(`/books/${res.book_id}/word`)
    },
    onError: (err) => {
      setSubmitError(apiErrorMessage(err))
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
    // ("employee" / "manager"). A field with `default: "true"` is treated as
    // checked unless the
    // operator explicitly unticks it — same `value !== false` rule as the
    // Report form's `sign` field below, generalized via the per-field default
    // instead of a hardcoded field id.
    const embedSignature: Record<string, boolean> = {}
    for (const field of schema?.fields ?? []) {
      if (field.type === 'hand_sign_checkbox') {
        const entity = field.id.replace(/^hand_sign_/, '')
        embedSignature[entity] =
          field.default === 'true' ? values[field.id] !== false : Boolean(values[field.id])
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

    // Preview and Save use the same attachment set. Keep empty lists undefined
    // so a revise with untouched attachments reuses the book's merged set
    // (the backend treats None as "keep").
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
      attachments: attachmentSpecs.length > 0 ? attachmentSpecs : undefined,
      // Revise mode: only the committed save regenerates a new version under
      // the existing book's ref (the backend requires commit=True for it).
      revise_of_book_id: commit ? reviseBookId ?? undefined : undefined,
      // Revise mode keeps the book's grade server-side; state stays 'unclassified' there.
      grade,
      // General Book: the classification drives the classified-register ref.
      classification_code: isGeneralBookForm ? classificationCode ?? undefined : undefined,
    }
  }

  const notifyPayload = showNotifyPreview
    ? buildPayload(currentFormValues, false)
    : null

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
        if (missingSlotKeys.length > 0) {
          toast.error(t('application.attachments.requiredHint', { slot: firstMissingSlotLabel }))
          return
        }
        const attachmentSpecs = toGenerateSpecs(filterStateToSlots(attachmentsState, visibleSlots))
        const managerField = schema?.fields.find((f) => f.type === 'manager_picker')
        const recipientField = schema?.fields.find((f) => f.type === 'recipient_picker')
        const ccField = schema?.fields.find((f) => f.type === 'recipient_multi_picker')
        const tableRowsValue = form.getValues('table_rows') as Record<string, string>[] | undefined
        const table_rows =
          Array.isArray(tableRowsValue) && tableRowsValue.length > 0 ? tableRowsValue : undefined
        wordSessionMutation.mutate({
          classification_code: classificationCode,
          recipient_id: recipientField ? ((values[recipientField.id] as number | null | undefined) ?? null) : null,
          subject,
          cc: Array.isArray(values[ccField?.id ?? '']) ? (values[ccField!.id] as string[]) : [],
          manager_id: managerField ? ((values[managerField.id] as number | null | undefined) ?? null) : null,
          template_name: templateName ?? undefined,
          table_rows,
          sign: true,
          grade,
          attachments: attachmentSpecs.length > 0 ? attachmentSpecs : undefined,
        })
      }
    }

    // Report form: author body in Word — route through the Word handoff, same as General Book word mode.
    if (isReportForm) {
      return form.handleSubmit((values) => {
        if (missingSlotKeys.length > 0) {
          toast.error(t('application.attachments.requiredHint', { slot: firstMissingSlotLabel }))
          return
        }
        const attachmentSpecs = toGenerateSpecs(filterStateToSlots(attachmentsState, visibleSlots))
        wordSessionMutation.mutate({
          subject: String(values.subject ?? '').trim(),
          recipient_id: (values.recipient_id as number | null | undefined) ?? null,
          signer_employee_id: String(values.signer_id ?? ''),
          sign: values.sign !== false,
          date: (values.report_date as string | undefined) ?? null,
          cc: [],
          grade,
          attachments: attachmentSpecs.length > 0 ? attachmentSpecs : undefined,
        })
      })
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
      if (pendingCommitToastRef.current !== undefined) {
        toast.dismiss(pendingCommitToastRef.current)
        pendingCommitToastRef.current = undefined
      }
      pendingCommitRef.current = commit
      if (commit) {
        pendingNotificationRef.current = showNotifyEmployee
          ? notifyEmployee ? 'enabled' : 'skipped'
          : undefined
      }
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
    (job: JobStatusResponse) => {
      setPreviewJobStatus(job.status)
      if (job.status === 'failed') {
        if (pendingCommitRef.current) {
          toast.error(t('application.toast.generateFailed'), {
            id: pendingCommitToastRef.current,
            description: job.error_message ?? undefined,
          })
          pendingCommitRef.current = false
          pendingCommitToastRef.current = undefined
          pendingNotificationRef.current = undefined
        }
        return
      }
      const saved = savedGenerationFromJob(job)
      void qc.invalidateQueries({ queryKey: ['books'] })
      // A generated superseding leave removes the absence days it covers.
      // The rows are deleted on the FIRST job that covers them (usually the
      // preview), so this announcement and invalidation are not gated on the committed save.
      const superseded = job.superseded_absence_dates ?? []
      const [firstDay, lastDay] = [superseded[0], superseded[superseded.length - 1]]
      if (firstDay && lastDay) {
        const dayFmt = (iso: string): string =>
          new Date(`${iso}T00:00:00`).toLocaleDateString(i18n.language, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
        toast.warning(
          t('absences.overwritten', {
            count: superseded.length,
            from: dayFmt(firstDay),
            to: dayFmt(lastDay),
          }),
        )
        void qc.invalidateQueries({ queryKey: ['employee-absences'] })
        void qc.invalidateQueries({ queryKey: ['employee-detail'] })
        void qc.invalidateQueries({ queryKey: [ACTIVITY_STATEMENT_QUERY] })
        void qc.invalidateQueries({ queryKey: ['absence-register'] })
      }
      if (pendingCommitRef.current && selectedTemplate) {
        if (saved) {
          setLastSaved({ ...saved, notification: pendingNotificationRef.current })
          toast.success(t('application.toast.saved'), { id: pendingCommitToastRef.current, reference: saved.ref })
        } else {
          toast.success(t('application.toast.generated'), {
            id: pendingCommitToastRef.current,
            reference: job.documents?.find((document) => document.role === 'primary')?.ref_number ?? undefined,
          })
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
        pendingCommitToastRef.current = undefined
        pendingNotificationRef.current = undefined
        // Revise mode is one-shot: after a successful committed save the book
        // is back to approval_state="none", so threading revise_of_book_id on a
        // SECOND save would hit the BOOK_NOT_REVISABLE guard. Clear it now (only
        // for committed saves, not previews) so subsequent saves behave normally.
        if (saved) setReviseParam(null)
      }
    },
    [qc, selectedTemplate, t, i18n.language, setReviseParam],
  )

  const handleSelectTemplate = useCallback((id: string) => {
    setSelectedTemplate(id)
    // Seed from localStorage so a reload mid-draft restores the form.
    // The actual values are applied by the effect below (after the schema
    // arrives so RHF doesn't reject keys for unmounted fields).
    form.reset({})
    attachmentsDirtyRef.current = false
    setAttachmentsState(emptyAttachmentsState())
    setActiveJobId(null)
    setPreviewJobStatus(null)
    setLastSaved(null)
    setInmateEntryMode('create')
    setApprovedImport(null)
    pendingNotificationRef.current = undefined
    // Per-book notify switch is not remembered — each newly-picked form starts On.
    setNotifyEmployee(true)
    setSubmitError(null)
    setClassificationCode(null)
    setGrade('unclassified')
    // M5: General Book is Word-only; the editor toggle is hidden. Reset to
    // 'word' (not 'editor') or the form flips back to HugeRTE on every re-pick.
    setBodyMode('word')
    setTemplateName(null)
  }, [form])

  // The shell stays mounted on same-path bell navigation. Hydrate each register
  // navigation (including the same URL again), not only the initial page mount.
  // Keep the canonical form parameter so reloads retain the statistics service.
  useEffect(() => {
    if (
      requestedInmateMode === null ||
      capabilitiesLoading ||
      approvedImportBusy ||
      hydratedStatsNavigationRef.current === location.key
    ) {
      return
    }
    const id = resolveTemplateIdFromSlug('inmate_conduct_violations', templates)
    if (!id) return
    hydratedStatsNavigationRef.current = location.key
    if (selectedTemplate !== id) handleSelectTemplate(id)
    setInmateEntryMode(requestedInmateMode === 'stats' && !has('books.view') ? 'create' : requestedInmateMode)
    setApprovedImport(null)
  }, [
    requestedInmateMode,
    capabilitiesLoading,
    approvedImportBusy,
    location.key,
    templates,
    selectedTemplate,
    handleSelectTemplate,
    has,
  ])

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
    let restoredValues: Record<string, unknown> | null = null
    if (draft) {
      // The draft payload carries the attachments state under a reserved
      // `__attachments` key (spec §6: a refresh keeps staged tokens). Split
      // it out before resetting RHF so the form never sees the blob.
      const { __attachments, ...values } = draft
      restoredValues = values
      base = parseAttachmentsState(__attachments)
      if (base) attachmentsDirtyRef.current = false
    }
    // Restore the draft into the form (if any), then prefill the Resignation
    // Letter's date to today — restoreThenSeedResignationDate owns that
    // ordering as one call, so there is no separate restore/seed sequence
    // left here for a future edit to reorder or make unconditional.
    restoreThenSeedResignationDate(
      form,
      restoredValues,
      !!schemaQuery.data?.fields?.some((f) => f.id === 'resignation_date'),
      todayIso(),
    )
    // Inmate Conduct Violations: report_date/report_time pre-fill with "now"
    // on open and stay editable before generating (mockup spec) — seeded
    // AFTER the draft restore above so a resumed draft's own values win.
    // seedReportDateTime owns that ordering as one call, same pattern as
    // restoreThenSeedResignationDate just above.
    seedReportDateTime(
      form,
      !!schemaQuery.data?.fields?.some((f) => f.id === 'report_date'),
      !!schemaQuery.data?.fields?.some((f) => f.id === 'report_time'),
      todayIso(),
      nowHM(),
    )
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

  // Clear the picked form back to the gallery state. Applied when the URL
  // leaves a service (back button, Ctrl+N, browser Back).
  const resetToGallery = useCallback(() => {
    if (approvedImportBusy) return
    form.reset({})
    setSelectedTemplate(null)
    attachmentsDirtyRef.current = false
    setAttachmentsState(emptyAttachmentsState())
    setActiveJobId(null)
    setPreviewJobStatus(null)
    setLastSaved(null)
    setInmateEntryMode('create')
    setApprovedImport(null)
    pendingNotificationRef.current = undefined
    // Per-book notify switch is not remembered — each newly-picked form starts On.
    setNotifyEmployee(true)
    setSubmitError(null)
    setClassificationCode(null)
    setGrade('unclassified')
    // M5: General Book is Word-only — reset to 'word', not 'editor' (see above).
    setBodyMode('word')
    setTemplateName(null)
  }, [approvedImportBusy, form])

  // The URL owns which service is open: every navigation (tile, Back, bell,
  // direct load) lands here. The monthly register is selected by its own effect.
  useEffect(() => {
    if (requestedInmateMode !== null || capabilitiesLoading || templates.length === 0) return
    const id = slug ? resolveTemplateIdFromSlug(slug, templates) : null
    if (slug && !id) {
      navigate('/services', { replace: true })
      return
    }
    if (id === selectedTemplate) return
    // A two-paper service opens on the UI language's paper, unless the user is
    // switching from its other paper or revising a book.
    const pair = PAPER_LANGUAGES.find((p) => p.en === id)
    if (
      pair &&
      isAr &&
      reviseBookId === null &&
      selectedTemplate !== pair.ar &&
      templates.some((tpl) => tpl.id === pair.ar)
    ) {
      navigate({ pathname: serviceHref(pair.ar), search: location.search }, { replace: true })
      return
    }
    if (id) handleSelectTemplate(id)
    else resetToGallery()
  }, [
    requestedInmateMode,
    capabilitiesLoading,
    templates,
    slug,
    selectedTemplate,
    isAr,
    reviseBookId,
    location.search,
    handleSelectTemplate,
    resetToGallery,
    navigate,
  ])

  const openService = useCallback(
    (id: string) => {
      const search = employeeIdFromUrl ? `?employee_id=${encodeURIComponent(employeeIdFromUrl)}` : ''
      navigate({ pathname: serviceHref(id), search })
    },
    [employeeIdFromUrl, navigate],
  )

  // Language tab: carry the values both papers print (items, delivery date,
  // manager) into the other paper's draft, which the restore effect applies
  // once that paper's fields load. Each paper keeps its own other fields.
  const switchPaper = useCallback(
    async (id: string) => {
      if (!selectedTemplate || id === selectedTemplate) return
      const target = await qc
        .fetchQuery({
          queryKey: ['template-fields', id],
          queryFn: () => api.getTemplateFields(id),
          staleTime: Infinity,
        })
        .catch(() => null)
      const values = form.getValues() as Record<string, unknown>
      saveDraft(selectedTemplate, { ...values, __attachments: attachmentsState })
      const shared = Object.fromEntries(
        (target?.fields ?? []).filter((f) => f.id in values).map((f) => [f.id, values[f.id]]),
      )
      saveDraft(id, { ...loadDraft(id), ...shared, __attachments: attachmentsState })
      navigate({ pathname: serviceHref(id), search: location.search }, { replace: true })
    },
    [selectedTemplate, qc, form, attachmentsState, navigate, location.search],
  )
  const openGallery = useCallback(() => {
    if (!approvedImportBusy) navigate('/services')
  }, [approvedImportBusy, navigate])

  // Ctrl+N — clear and pick again from the gallery.
  useShortcutAction('newItem', openGallery)

  const previewTabLabel = t('application.tabs.preview')
  // A two-paper service is titled by its English entry's catalog name.
  const titleMeta =
    (paperPair && templates.find((tpl) => tpl.id === paperPair.en)) || selectedMeta
  const selectedTemplateName = titleMeta ? (isAr ? titleMeta.name_ar : titleMeta.name_en) : ''
  const selectedTemplateArtwork = selectedTemplate
    ? artworkForTemplate(selectedTemplate)
    : undefined

  // Gallery tiles: the Arabic paper of a two-paper service hides behind its
  // English tile (when both are allowed) and is reached through the form's tab.
  const galleryTemplates = useMemo(
    () =>
      templates.filter(
        (tpl) =>
          !PAPER_LANGUAGES.some(
            (p) => p.ar === tpl.id && templates.some((other) => other.id === p.en),
          ),
      ),
    [templates],
  )

  // Every tile the user can open, by id. Synthetic tiles (record shortcuts and the
  // Inmate Conduct Violations entry modes) show only when their destination would
  // let the user act. Insertion order is the flat search-result order.
  const tileMap = new Map<string, GalleryTile>()
  const nsTitle = t('leaves.type.National Service')
  const dlTitle = t('dutyLocations.tile.name')
  const absTitle = t('absences.tile.name')
  if (has('leaves.view') && has('leaves.create')) {
    tileMap.set(NATIONAL_SERVICE_ID, {
      id: NATIONAL_SERVICE_ID,
      name: nsTitle,
      searchText: nsTitle,
      category: t('application.nsCategory'),
      emoji: '🎖️',
      artwork: 'national-service',
      onSelect: () => navigate('/leaves?action=ns-new'),
    })
  }
  if (isQuickActionAllowed('General Book', has) && has('documents.duty_transfer')) {
    tileMap.set(DUTY_LOCATIONS_ID, {
      id: DUTY_LOCATIONS_ID,
      name: dlTitle,
      searchText: dlTitle,
      category: t('dutyLocations.tile.category'),
      emoji: '🚚',
      artwork: 'duty-locations',
      onSelect: () => navigate('/duty-locations'),
    })
  }
  if (has('leaves.view') && has('leaves.edit')) {
    tileMap.set(EMPLOYEE_ABSENCE_ID, {
      id: EMPLOYEE_ABSENCE_ID,
      name: absTitle,
      searchText: absTitle,
      category: t('dutyLocations.tile.category'),
      emoji: '🚫',
      artwork: 'employee-absence',
      onSelect: () => navigate('/absences'),
    })
  }
  for (const tpl of galleryTemplates) {
    const name = isAr ? tpl.name_ar : tpl.name_en
    tileMap.set(tpl.id, {
      id: tpl.id,
      name,
      searchText: `${tpl.name_en} ${tpl.name_ar} ${tpl.id}`,
      category: t(`application.formList.${tpl.category}`),
      emoji: emojiForTemplate(tpl.id),
      artwork: artworkForTemplate(tpl.id),
      basketCount: basketCounts[tpl.id] ?? 0,
      hasCode: tpl.has_code,
      onSelect: () => openService(tpl.id),
    })
    if (tpl.id === 'Inmate Conduct Violations') {
      // The entry modes that used to hide behind this form's tabs are services of their own.
      const inmateHref = serviceHref(tpl.id)
      const importTitle = t('application.importSignedViolation')
      tileMap.set(INMATE_IMPORT_SIGNED_ID, {
        id: INMATE_IMPORT_SIGNED_ID,
        name: importTitle,
        searchText: importTitle,
        category: t('application.formList.admin'),
        emoji: '📥',
        artwork: 'inmate-approved-upload',
        onSelect: () => navigate(`${inmateHref}?mode=upload`),
      })
      if (has('books.view')) {
        const statsTitle = t('application.approvedViolation.monthlyStatistics')
        tileMap.set(INMATE_MONTHLY_STATS_ID, {
          id: INMATE_MONTHLY_STATS_ID,
          name: statsTitle,
          searchText: statsTitle,
          category: t('application.formList.admin'),
          emoji: '📊',
          artwork: 'inmate-monthly-statistics',
          onSelect: () => navigate(`${inmateHref}?mode=stats`),
        })
      }
    }
  }

  // Search is global: while the box has text, results ignore the folders.
  const searchQuery = query.trim().toLowerCase()
  const searching = searchQuery !== ''
  const searchTiles = [...tileMap.values()].filter((tile) =>
    tile.searchText.toLowerCase().includes(searchQuery),
  )

  // Folders: configured groups with at least one openable tile, then an "Other"
  // folder for any tile no group lists so a new service is never invisible.
  const galleryGroups = SERVICE_GROUPS.map((g) => ({
    id: g.id,
    icon: g.icon,
    tiles: g.items.flatMap((id) => tileMap.get(id) ?? []),
  })).filter((g) => g.tiles.length > 0)
  const groupedIds = new Set(SERVICE_GROUPS.flatMap((g) => g.items))
  const ungroupedTiles = [...tileMap.values()].filter((tile) => !groupedIds.has(tile.id))
  if (ungroupedTiles.length > 0) {
    galleryGroups.push({ id: OTHER_GROUP_ID, icon: OTHER_GROUP_ICON, tiles: ungroupedTiles })
  }
  const activeGroup = galleryGroups.find((g) => g.id === groupId) ?? null
  const galleryGridCls =
    'grid grid-cols-2 gap-3 [grid-auto-rows:1fr] sm:grid-cols-3 lg:grid-cols-4'
  const renderTile = (tile: GalleryTile): React.JSX.Element => (
    <ServiceCell
      key={tile.id}
      name={tile.name}
      category={tile.category}
      emoji={tile.emoji}
      artwork={tile.artwork}
      basketCount={tile.basketCount}
      hasCode={tile.hasCode}
      onSelect={tile.onSelect}
    />
  )

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
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
                {t('application.meta', { count: galleryTemplates.length })}
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
              ) : (searching ? searchTiles.length : galleryGroups.length) === 0 ? (
                <p className="py-12 text-center text-[0.86em] text-muted-foreground">
                  {t('application.noServicesMatch')}
                </p>
              ) : searching ? (
                <div className={galleryGridCls}>{searchTiles.map(renderTile)}</div>
              ) : activeGroup ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setGroupId(null)}
                    className="mb-3 inline-flex items-center gap-1.5 text-[0.86em] font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {isAr ? (
                      <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                    ) : (
                      <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                    )}
                    {t('application.backToAllServices')}
                  </button>
                  <div className="mb-4 flex items-center gap-3">
                    <img src={activeGroup.icon} alt="" draggable={false} className="h-12 w-12 object-contain" />
                    <h3 className="text-[1.25em] font-semibold tracking-tight text-foreground">
                      {t(`application.serviceGroups.${activeGroup.id}`)}
                    </h3>
                  </div>
                  <div className={galleryGridCls}>{activeGroup.tiles.map(renderTile)}</div>
                </div>
              ) : (
                <div className={galleryGridCls}>
                  {galleryGroups.map((g) => (
                    <FolderCell
                      key={g.id}
                      name={t(`application.serviceGroups.${g.id}`)}
                      description={t(`application.serviceGroupDescriptions.${g.id}`)}
                      count={t('application.groupCount', { count: g.tiles.length })}
                      icon={g.icon}
                      tiles={g.tiles}
                      onSelect={() => setGroupId(g.id)}
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
                onClick={openGallery}
                disabled={approvedImportBusy}
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
                  {selectedTemplateArtwork ? (
                    <ServiceArtwork artwork={selectedTemplateArtwork} size="gallery" />
                  ) : (
                    emojiForTemplate(selectedTemplate)
                  )}
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

            {paperChoice && selectedTemplate && (
              <Tabs value={selectedTemplate} onValueChange={(id) => void switchPaper(id)} className="mb-4">
                <TabsList
                  aria-label={t('application.paperLanguage')}
                  className="inline-flex gap-1 rounded-lg border border-border bg-surface-tinted p-1 [[data-theme=dark]_&]:bg-background"
                >
                  <TabsTrigger value={paperChoice.en} lang="en" className={paperTabCls}>
                    English
                  </TabsTrigger>
                  <TabsTrigger value={paperChoice.ar} lang="ar" className={paperTabCls}>
                    العربية
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}

            {isInmateService && (
              <div data-print-hide className="mb-4 inline-flex rounded-xl border border-border bg-surface-tinted p-1">
                <Button
                  type="button"
                  size="sm"
                  variant={inmateEntryMode === 'create' ? 'default' : 'ghost'}
                  aria-pressed={inmateEntryMode === 'create'}
                  disabled={approvedImportBusy}
                  onClick={() => {
                    if (approvedImportBusy) return
                    setInmateEntryMode('create')
                    setApprovedImport(null)
                  }}
                >
                  {t('application.approvedViolation.createForm')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={inmateEntryMode === 'upload' ? 'default' : 'ghost'}
                  aria-pressed={inmateEntryMode === 'upload'}
                  disabled={approvedImportBusy}
                  onClick={() => {
                    if (approvedImportBusy) return
                    setInmateEntryMode('upload')
                    setApprovedImport(null)
                  }}
                >
                  {t('application.approvedViolation.uploadApproved')}
                </Button>
                {has('books.view') && (
                  <Button
                    type="button"
                    size="sm"
                    variant={inmateEntryMode === 'stats' ? 'default' : 'ghost'}
                    aria-pressed={inmateEntryMode === 'stats'}
                    disabled={approvedImportBusy}
                    onClick={() => {
                      if (approvedImportBusy) return
                      setInmateEntryMode('stats')
                      setApprovedImport(null)
                    }}
                  >
                    {t('application.approvedViolation.monthlyStatistics')}
                  </Button>
                )}
              </div>
            )}
            {isInmateService && has('messages.broadcast') && <InmateViolationGroupPicker />}

            {isInmateService && inmateEntryMode === 'upload' && (
              <section className="rounded-2xl bg-surface px-4 py-6 sm:px-7">
                {approvedImport ? (
                  <div data-testid="approved-import-success" className="space-y-4">
                    <h3
                      ref={approvedImportSuccessRef}
                      tabIndex={-1}
                      className="rounded-sm text-base font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      {t('application.approvedViolation.successTitle')}
                    </h3>
                    <SavedRecordActions
                      bookId={approvedImport.book_id}
                      refNumber={approvedImport.ref_number}
                      detail={t('application.approvedViolation.approvedCopyFiled')}
                    />
                    <div className="flex flex-wrap justify-end gap-2">
                      {has('books.view') && (
                        <Button
                          type="button"
                          variant="link"
                          onClick={() => setInmateEntryMode('stats')}
                        >
                          {t('application.approvedViolation.openRegister')}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setApprovedImport(null)}
                      >
                        {t('application.approvedViolation.newUpload')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <ApprovedViolationUpload
                    onSaved={setApprovedImport}
                    onSaveBusyChange={setApprovedImportBusy}
                  />
                )}
              </section>
            )}
            {isInmateService && inmateEntryMode === 'stats' && has('books.view') && (
              <section className="rounded-2xl bg-surface px-4 py-6 sm:px-7">
                <StatisticsTab />
              </section>
            )}
            <section
              hidden={isInmateService && inmateEntryMode !== 'create'}
              className="rounded-2xl bg-surface px-4 py-6 sm:px-7"
            >
              {/* Service tabs share the form's horizontally scrollable strip. */}
              <div className="mb-5 flex items-center gap-1 overflow-x-auto border-b border-hairline pb-4">
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
                {hasNotificationTab && (
                  <TabButton
                    active={activeTab === 'notification'}
                    onClick={() => setActiveTab('notification')}
                  >
                    {t('msgTemplates.tabs.notification')}
                  </TabButton>
                )}
                {hasDraftTab && (
                  <TabButton
                    active={activeTab === 'email-draft'}
                    onClick={() => setActiveTab('email-draft')}
                  >
                    {t('msgTemplates.tabs.emailDraft')}
                  </TabButton>
                )}

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
              {activeTab === 'notification' && selectedTemplate && (
                <ServiceNotificationTab service={selectedTemplate} />
              )}
              {activeTab === 'email-draft' && selectedTemplate && (
                <ServiceDraftTab service={selectedTemplate} />
              )}
              {activeTab === 'fields' && (
                <div
                  className={
                    // General Book and other forms with the full Word-like
                    // ribbon need an A4-width canvas. Table/grid-heavy forms
                    // (clearance, items, violation checkboxes) need room for
                    // their many columns. Plain forms stay at a tight,
                    // readable measure. Report: body is in Word so skip the
                    // arabic_rich_full width expansion.
                    formWidthClass(
                      isReportForm
                        ? schema?.fields.filter((f) => f.type !== 'arabic_rich_full')
                        : schema?.fields,
                    )
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
                          Preview includes supplied papers; required slots gate
                          Save book and Create & open in Word, not Preview. */}
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
                            <GradeSelect value={grade} onChange={setGrade} className="w-full sm:w-60" />
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
                        ) : isReportForm ? (
                          // Report form: author body in Word — same Word handoff as General Book.
                          <>
                            <GradeSelect value={grade} onChange={setGrade} className="w-full sm:w-60" />
                            <p className="text-[0.78em] text-muted-foreground">
                              {t('books.word.bodyInWord')}
                            </p>
                            <Button
                              type="submit"
                              size="commit"
                              disabled={
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
                  {previewJobStatus === 'done' && !lastSaved && (
                    <GeneratedSaveActions
                      signingPath={schemaQuery.data?.signing_path}
                      showNotify={showNotifyEmployee}
                      notifyEmployee={notifyEmployee}
                      previewBody={notifyPayload ? {
                        template_id: notifyPayload.template_id,
                        employee_id: notifyPayload.employee_id ?? null,
                        fields: notifyPayload.fields,
                        revise_of_book_id: reviseBookId,
                      } : null}
                      notifyDisabled={generateMutation.isPending}
                      saveDisabled={
                        (!isAdminCategory && !selectedEmployee) ||
                        generateMutation.isPending ||
                        missingSlotKeys.length > 0
                      }
                      saving={generateMutation.isPending && pendingCommitRef.current}
                      hint={
                        missingSlotKeys.length > 0
                          ? t('application.attachments.requiredHint', {
                              slot: firstMissingSlotLabel,
                            })
                          : t('application.saveReadyHint')
                      }
                      onNotifyChange={setNotifyEmployee}
                      onSave={() => void handleSave()}
                      grade={reviseBookId == null ? grade : undefined}
                      onGradeChange={setGrade}
                    />
                  )}

                  {lastSaved && (
                    <SavedRecordActions
                      bookId={lastSaved.bookId}
                      refNumber={lastSaved.ref}
                      notification={lastSaved.notification}
                    />
                  )}

                  <JobStatus
                    key={activeJobId}
                    jobId={activeJobId}
                    onDone={handleJobDone}
                    onFailed={handleJobDone}
                    onPollingStopped={() => {
                      setPreviewJobStatus('failed')
                      if (pendingCommitToastRef.current !== undefined) {
                        toast.warning(t('errors.network'), { id: pendingCommitToastRef.current })
                        pendingCommitToastRef.current = undefined
                      }
                      pendingCommitRef.current = false
                      pendingNotificationRef.current = undefined
                    }}
                  />

                  {lastSaved && selectedTemplate && employeeQuery.data && (
                    <div className="mt-4 flex justify-end">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
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
                            bookId: lastSaved.bookId,
                            docId: lastSaved.docId,
                            ref: lastSaved.ref,
                            employeeId: selectedEmployee as string,
                            nameEn: employeeQuery.data.name_en ?? '',
                            nameAr: employeeQuery.data.name_ar ?? null,
                            formKind: selectedTemplate,
                            classificationCode: isGeneralBookForm
                              ? classificationCode
                              : typeof v.classification_code === 'string' ? v.classification_code : null,
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
                    </div>
                  )}
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

/** One folder in the Services gallery, with a decorative preview of its visible services. */
function FolderCell({
  name,
  description,
  count,
  icon,
  tiles,
  onSelect,
}: {
  name: string
  description: string
  count: string
  icon: string
  tiles: readonly GalleryTile[]
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${name} ${count}`}
      className="service-tile group relative flex h-full min-h-[170px] w-full flex-col items-start rounded-2xl border-t-4 border-primary bg-surface p-4 text-start shadow-sm ring-1 ring-hairline transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-1 hover:shadow-md focus-visible:-translate-y-1 focus-visible:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:!translate-none motion-reduce:transition-none"
    >
      <span className="flex min-h-[5.125rem] w-full items-start gap-3">
        <img
          src={icon}
          alt=""
          draggable={false}
          className="h-[4.5rem] w-[4.5rem] min-w-0 object-contain transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-1.5 group-focus-visible:-translate-y-1.5 motion-reduce:!translate-none motion-reduce:transition-none"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none ms-auto grid shrink-0 grid-cols-2 gap-[0.3rem] rounded-[0.8rem] bg-surface-tinted p-[0.4rem] opacity-55 transition-opacity duration-200 group-hover:opacity-85 group-focus-visible:opacity-85 motion-reduce:transition-none"
        >
          {tiles.slice(0, tiles.length === 4 ? 4 : 3).map((tile) => (
            <span key={tile.id} className="grid h-8 w-8 place-items-center rounded-lg bg-surface p-1">
              {tile.artwork ? (
                <ServiceArtwork artwork={tile.artwork} size="row" />
              ) : (
                <span className="text-lg leading-none">{tile.emoji}</span>
              )}
            </span>
          ))}
          {tiles.length > 4 && (
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-surface text-[0.7em] font-bold text-muted-foreground">
              <bdi dir="ltr">+{tiles.length - 3}</bdi>
            </span>
          )}
        </span>
      </span>
      <span className="mt-2.5 line-clamp-2 text-[0.95em] font-semibold leading-snug text-foreground">
        {name}
      </span>
      <span className="mt-1 block w-full line-clamp-2 text-[0.72em] leading-relaxed text-muted-foreground">
        {description}
      </span>
      <span className="mt-auto pt-1.5 text-[0.68em] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {count}
      </span>
    </button>
  )
}

/** One service card in the Services gallery.
 *
 * Mirrors the design-system service tile (components-service-tile.html):
 * left-aligned card, 4px primary top accent, emoji → title → category
 * sub-line, equal-height rows (parent grid uses `grid-auto-rows: 1fr`). */
function ServiceCell({
  name,
  category,
  emoji,
  artwork,
  basketCount,
  hasCode,
  onSelect,
}: {
  name: string
  category: string
  emoji: string
  artwork?: ServiceArtworkId
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
      className="service-tile group relative flex h-full min-h-[120px] w-full flex-col items-start rounded-2xl border-t-4 border-primary bg-surface p-4 text-start shadow-sm ring-1 ring-hairline transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-1 hover:shadow-md focus-visible:-translate-y-1 focus-visible:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:!translate-none motion-reduce:transition-none"
    >
      {hasCode !== undefined && <CodeBadge hasCode={hasCode} />}
      {artwork ? (
        <span className="block w-8 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-1.5 group-focus-visible:-translate-y-1.5 motion-reduce:!translate-none motion-reduce:transition-none">
          <ServiceArtwork artwork={artwork} size="gallery" />
        </span>
      ) : (
        <span
          className="block text-[1.6em] leading-none transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-[3px] group-focus-visible:-translate-y-[3px] motion-reduce:!translate-none motion-reduce:transition-none"
          aria-hidden
        >
          {emoji}
        </span>
      )}
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
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={[
        'relative inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 py-1.5 text-[0.78em] font-medium transition-colors md:min-h-0',
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
