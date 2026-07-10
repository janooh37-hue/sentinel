/**
 * Typed API client.
 *
 * Wraps `fetch` with three things the rest of the app needs:
 *
 * 1. Type inference from `api.types.ts` (regenerated via `npm run gen:api`).
 *    Components import `EmployeeRead`, `VaultTree`, etc. from here instead of
 *    duplicating the shape.
 * 2. Error-envelope parsing — the backend always returns
 *    `{ error: { code, message, details } }` on non-2xx, and `ApiError` carries
 *    those fields so UI code can switch on `err.code`.
 * 3. A `multipart` helper that builds the right body for vault uploads (the
 *    only place we POST FormData).
 */

import type { components, paths } from './api.types'
import type { ExtractedFieldOut } from './extraction'

// Passport OCR extract (Task 8).
// Re-exported from the generated schema; declared here so consumers import from
// '@/lib/api' rather than reaching into api.types directly.
export type PassportSuggestion = components['schemas']['PassportSuggestion']

// Employee lookup completeness summary (Task 3).
export type CompletenessSummaryOut = components['schemas']['CompletenessSummaryOut']

// Phase B — Expiry Dashboard + Alerts
export interface ExpiryItem {
  employee_id: string
  name_en: string
  name_ar: string | null
  doc_type: 'uae_id' | 'passport'
  expiry_date: string
  days_remaining: number
  bucket: 'expired' | 'critical' | 'soon'
}

export interface ExpirySummary {
  expired: number
  critical: number
  urgent: number
}

// Phase 09 — Migration
export interface MigrationStatus {
  has_db: boolean
  has_data: boolean
  v3_data_dir_detected: string | null
  last_migration: string | null
}

export interface MigrateRequest {
  v3_data_dir: string
  dry_run: boolean
}

export interface MigrationResult {
  dry_run: boolean
  employees: number
  leaves: number
  books: number
  vault_files: number
  violations: number
  backup_path: string | null
}

// Phase 08 — Settings + System
// Hand-augmented with signature appearance fields (Task 6) ahead of gen:api.
// Task 10: sms_autosend_enabled added ahead of next gen:api run.
export type AppSettingsRead = components['schemas']['AppSettingsRead'] & {
  signature_size_mm: number
  signature_boldness: number
  sms_autosend_enabled: boolean
}
export type AppSettingsUpdate = components['schemas']['AppSettingsUpdate'] & {
  signature_size_mm?: number
  signature_boldness?: number
  sms_autosend_enabled?: boolean
}
export type SystemInfo = components['schemas']['SystemInfo']
export type UpdateCheckResult = components['schemas']['UpdateCheckResult']
export type AdminKeyResponse = components['schemas']['AdminKeyResponse']
export type SubmitterCreate = components['schemas']['SubmitterCreate']
export type Theme = AppSettingsRead['theme']
export type FontScale = AppSettingsRead['font_scale']

// Phase 18 — Dashboard layout (widget + quick-action visibility / order).
export type DashboardLayout = components['schemas']['DashboardLayout']
export type DashboardWidgetConfig = components['schemas']['DashboardWidgetConfig']
export type DashboardQuickActionConfig = components['schemas']['DashboardQuickActionConfig']

// After gen:api (Task 8), the generated EmployeeRead now carries has_photo,
// photo_version, duty_unit, duty_post, passport_no_source, has_passport_scan,
// and msg_language directly. Retain the augment only for fields that remain
// absent from the generated schema (currently none needed, but keep the
// intersection form so the pattern is clear for future additions).
export type EmployeeRead = components['schemas']['EmployeeRead'] & {
  // All previously hand-mirrored fields are now in the generated schema.
  // Keeping this intersection allows future augments without refactoring consumers.
  has_photo?: boolean
  photo_version?: string | null
}
export type EmployeeListItem = components['schemas']['EmployeeListItem'] & {
  has_photo?: boolean
  position_ar?: string | null
  // Duty-location projection — added so the roster fetch carries unit/post.
  duty_unit?: string | null
  duty_post?: string | null
}
export type EmployeeListResponse = Omit<
  components['schemas']['EmployeeListResponse'],
  'items'
> & { items: EmployeeListItem[] }
export type EmployeeCreate = components['schemas']['EmployeeCreate']
export type EmployeeUpdate = components['schemas']['EmployeeUpdate'] & {
  // Duty-location columns — accepted by PATCH ahead of `gen:api`.
  duty_unit?: string | null
  duty_post?: string | null
  // WhatsApp notification language — accepted by PATCH ahead of `gen:api`.
  msg_language?: 'ar' | 'en' | null
}
export type EmployeeStatus = EmployeeRead['status']

// gen:api now folds the SMS history field into the schema — use the generated type.
export type SmsMessageRead = components['schemas']['SmsMessageRead']
export type EmployeeDetailRead = components['schemas']['EmployeeDetailRead']
export type EmployeeStatsRead = components['schemas']['EmployeeStatsRead']
export type RecentDocumentRead = components['schemas']['RecentDocumentRead']
export type RecentLeaveRead = components['schemas']['RecentLeaveRead']
export type RecentViolationRead = components['schemas']['RecentViolationRead']
export type RecentLedgerRead = components['schemas']['RecentLedgerRead']
export type ActivityItemRead = components['schemas']['ActivityItemRead']

export type ViolationRead = components['schemas']['ViolationRead']
export type ViolationCreate = components['schemas']['ViolationCreate']
export type ViolationUpdate = components['schemas']['ViolationUpdate']

// The backend now returns the employee's bilingual name alongside each leave
// row so the Records table can render a name instead of a raw G-number. These
// optional fields are hand-mirrored until `npm run gen:api` folds them into the
// generated schema (integration re-runs gen:api).
export type LeaveRead = components['schemas']['LeaveRead'] & {
  employee_name_en?: string | null
  employee_name_ar?: string | null
}
export type LeaveListItem = components['schemas']['LeaveListItem'] & {
  employee_name_en?: string | null
  employee_name_ar?: string | null
}
export type LeaveListResponse = components['schemas']['LeaveListResponse']
export type LeaveCreate = components['schemas']['LeaveCreate']
export type LeaveUpdate = components['schemas']['LeaveUpdate']
export type LeaveBalanceRead = components['schemas']['LeaveBalanceRead']
export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled' | 'Completed'

export interface LeaveReturnBody {
  resumption_date: string // ISO yyyy-mm-dd
  delay_reason?: string
  manager_id?: number | null
}

// Duty Locations & Internal Transfers — frozen API contract (backend in
// parallel; hand-mirrored until `gen:api`).
export interface DutyTransferRequest {
  employee_ids: string[]
  to_unit: string
  to_post: string | null
  recipient_id: number | null
  manager_id: number | null
  cc: string[] | null
}

export interface DutyTransferResult {
  book_id: number | null
  ref: string | null
  document_id: number | null
  moved: string[]
}

export type VaultTree = components['schemas']['VaultTree']
export type VaultEntry = components['schemas']['VaultEntry']
// Pydantic's ``Literal`` collapses into an inline union when OpenAPI generates
// the schema, so ``VaultKind`` doesn't get its own component entry. We hand-
// mirror it here and keep it in sync with `schemas/vault_file.py::VaultKind`.
export type VaultKind = 'uae_id' | 'passport' | 'other' | 'leaves' | 'violations'

export type HealthResponse =
  paths['/api/v1/system/health']['get']['responses']['200']['content']['application/json']

// Phase 10 — Editor templates (HugeRTE save/load)
export type EditorTemplateRead = components['schemas']['EditorTemplateRead']
export type EditorTemplateListItem = components['schemas']['EditorTemplateListItem']
export type EditorTemplateListResponse = components['schemas']['EditorTemplateListResponse']
export type EditorTemplateCreate = components['schemas']['EditorTemplateCreate']
export type EditorTemplateUpdate = components['schemas']['EditorTemplateUpdate']

// Phase 13 — Email integration (IMAP → ledger auto-create + SMTP send)
export type EmailAccountRead = components['schemas']['EmailAccountRead']
export type EmailAccountUpsert = components['schemas']['EmailAccountUpsert']
export type EmailSyncResult = components['schemas']['EmailSyncResult']
export type EmailSyncStatus = components['schemas']['EmailSyncStatus']
// ``/email/send`` is a multipart endpoint so openapi-typescript can't infer
// its body shape. Mirror the Pydantic schema by hand.
export interface EmailSendRequest {
  to: string[]
  cc?: string[]
  subject: string
  html: string
  in_reply_to?: string | null
  references?: string | null
  /** Phase 15 — when true (default) the backend appends the configured
   * `settings.email_signature` to the outgoing HTML body. */
  use_signature?: boolean
}
export type EmailSendResult = components['schemas']['EmailSendResult']

// Phase 14 — Identity linking. `email` was added to the backend schema
// (2026-05-26 identity collapse) but openapi-typescript hasn't regenerated yet,
// so hand-merge it until `npm run gen:api` runs.
export type IdentityRead = components['schemas']['IdentityRead'] & {
  email?: string | null
}

// Multi-user auth (2026-05-24). Hand-mirrored from backend/app/schemas/auth.py
// so we don't depend on a gen:api run to ship the login screen.
export interface SessionUser {
  id: number
  email: string
  employee_id: string | null
  name_en: string | null
  name_ar: string | null
  position: string | null
  department: string | null
  photo_url: string | null
  role: 'operator' | 'manager' | 'admin'
  status: 'pending' | 'active' | 'locked' | 'disabled'
  is_admin: boolean
  is_manager: boolean
  /** Whether the user has a per-user *signing* signature on file (used when
   * approving/signing a book). Distinct from the employee-vault signature. */
  has_signature: boolean
}

export interface RegisterResult {
  status: 'active' | 'pending'
  is_first: boolean
  user: SessionUser | null
}

export interface AdminUserRead {
  id: number
  email: string
  employee_id: string | null
  display_name: string | null
  name_en: string | null
  role: 'operator' | 'manager' | 'admin'
  status: 'pending' | 'active' | 'locked' | 'disabled' | 'rejected'
  failed_attempts: number
  last_login_at: string | null
  created_at: string | null
  /** Single-holder flag — this user receives auto-submitted `in_app` forms
   * (forms signing paths, 2026-06-11). Set via `api.setDefaultManager`. */
  is_default_manager: boolean
}

export interface AuditEntryRead {
  id: number
  action: string
  actor: string | null
  target_email: string | null
  target_g: string | null
  target_name: string | null
  role: string | null
  reason: string | null
  ts: string
}

export interface RegisterRequest {
  email: string
  password: string
  g_number?: string | null
  display_name?: string | null
}

// Granular permission system (2026-05-26). Hand-mirrored from
// backend/app/schemas/auth.py + core/permissions.py.
export type PermissionEffect = 'grant' | 'deny'

export interface CapabilityRead {
  id: string
  domain: string
  label: string
  description: string
  default_roles: Array<'operator' | 'manager' | 'admin'>
}

// Permission requests (Task 10 — employee permission-request UI).
// Hand-mirrored from backend/app/schemas/auth.py PermissionRequestRead.
export type PermissionRequestStatus = 'pending' | 'granted' | 'refused'
export interface PermissionRequestRead {
  id: number
  user_id: number
  requester_name: string | null
  capability: string
  capability_label: string
  status: PermissionRequestStatus
  decision: string | null
  created_at: string
}

export interface UserPermissionRead {
  user_id: number
  role: 'operator' | 'manager' | 'admin'
  is_admin: boolean
  effective: string[]
  role_defaults: string[]
  overrides: Record<string, PermissionEffect>
}

// Phase 07 — Ledger
// `inline_images` (Phase 15) + `draft_meta` (Phase 16) are added to the backend
// schema; openapi-typescript may not yet have regenerated it. Hand-merge until
// `npm run gen:api` runs.
export interface LedgerDraftMeta {
  to?: string[]
  cc?: string[]
  in_reply_to?: string | null
  references?: string | null
}
/** Per-attachment metadata (name + byte size) returned by GET /ledger/{id}.
 * Hand-typed until backend regenerates openapi.json. `size` is 0 when the
 * file is missing on disk. */
export interface LedgerAttachmentMeta {
  /** Position in `attachment_paths` — used to address the file by index so
   * Arabic/spaced filenames never enter the URL path. */
  index: number
  name: string
  size: number
}
export type LedgerEntryRead = components['schemas']['LedgerEntryRead'] & {
  inline_images?: Record<string, string>
  draft_meta?: LedgerDraftMeta | null
  /** Phase 17 — `read_at` is set the first time an incoming email entry is
   * opened in the drawer. NULL means the entry is unread and counts toward
   * the NavBell badge total. Hand-typed until backend regenerates openapi. */
  read_at?: string | null
  /** Email-detail redesign — per-attachment name + size; populated by
   * GET /{id} only. Falls back to `attachment_paths` when absent. */
  attachments?: LedgerAttachmentMeta[]
}

// Phase 17 — Ledger read state (drives the NavBell numeric badge).
export interface LedgerUnreadCount {
  count: number
}
export interface LedgerMarkAllReadResult {
  updated: number
}

// Phase 17 — NavBell popover preview row (newest N unread incoming entries).
// Hand-typed until backend regenerates openapi.json with `UnreadRecentItem` /
// `UnreadRecentResponse` schemas.
export interface UnreadRecentItem {
  id: number
  subject: string
  counterparty: string
  counterparty_name: string | null
  entry_date: string
  preview: string
  attachment_count: number
}
export interface UnreadRecentResponse {
  items: UnreadRecentItem[]
  total_unread: number
}

// Phase 16 — Search + drafts + send-to-vault.
// Hand-typed until backend regenerates openapi.json.
export interface LedgerSearchHit {
  entry: LedgerEntryRead
  snippet: string
  score: number
}
export interface LedgerSearchResponse {
  hits: LedgerSearchHit[]
  total: number
}
export interface DraftWrite {
  to: string[]
  cc?: string[]
  subject: string
  html: string
  in_reply_to?: string | null
  references?: string | null
}
export type LedgerEntryCreate = components['schemas']['LedgerEntryCreate']
export type LedgerEntryUpdate = components['schemas']['LedgerEntryUpdate']
export type LedgerListItem = components['schemas']['LedgerListItem']
export type LedgerListResponse = components['schemas']['LedgerListResponse']
export type LedgerDirection = LedgerEntryCreate['direction']
export type LedgerChannel = LedgerEntryCreate['channel']

// --- Ledger→Outlook Phase 1–4: automated Correspondence Log + address book ---
export type CorrespondenceLogItem = components['schemas']['CorrespondenceLogItem']
export type CorrespondenceLogResponse =
  components['schemas']['CorrespondenceLogResponse']
export type CorrespondenceLogRecord =
  components['schemas']['CorrespondenceLogRecord']
export type CorrespondenceCategoryRead =
  components['schemas']['CorrespondenceCategoryRead']
export type CorrespondenceCategoryCreate =
  components['schemas']['CorrespondenceCategoryCreate']
export type CorrespondenceRuleRead =
  components['schemas']['CorrespondenceRuleRead']
export type CorrespondenceRuleCreate =
  components['schemas']['CorrespondenceRuleCreate']
export type CorrespondenceRuleUpdate =
  components['schemas']['CorrespondenceRuleUpdate']
export type AddressBookContactRead =
  components['schemas']['AddressBookContactRead']
export type LedgerAddress = components['schemas']['LedgerAddress']
export type UnreadCountResponse = components['schemas']['UnreadCountResponse']
export type RecipientListRead = components['schemas']['RecipientListRead']
export type RecipientListMember = components['schemas']['RecipientListMember']
export type RecipientListCreate = components['schemas']['RecipientListCreate']
export type RecipientListUpdate = components['schemas']['RecipientListUpdate']

// Phase C — Universal Intake Drop-zone
// Hand-mirrored from backend/app/schemas/intake.py + extraction.py.
// ``ExternalOut.extraction`` is the list of extracted fields (same shape as
// ``ExtractionResponse.fields``); the field is named ``extraction`` in the
// backend schema — keep that name here.
export interface ReturnedFormOut {
  mode: 'returned_form'
  book_id: number
  ref_number: string
  approval_state: string
  category: string | null
  subject: string | null
  employee_id: string | null
  employee_name: string | null
}

export interface ExternalOut {
  mode: 'external'
  document_type: string
  document_type_confidence: number
  alternatives: string[]
  extraction: ExtractedFieldOut[]
  matched_employee_id: string | null
  match_score: number
  matched_employee_name_en: string | null
  matched_employee_name_ar: string | null
  route_kind: 'employee' | 'salary_transfer' | 'leave' | 'manual'
  route_form_slug: string | null
}

export type IntakeResponse = ReturnedFormOut | ExternalOut

export interface EmployeeCandidate {
  employee_id: string
  name_en: string
  name_ar: string | null
  score: number
}

// Scan Inbox — hand-mirrored from backend/app/schemas/scan_inbox.py.
// Consumed by Tasks 11–13 (ScanInbox page, hooks, components).
export interface ScanInboxItem {
  id: number
  created_at: string
  source: string
  state: 'pending_ocr' | 'auto_filed' | 'awaiting_confirmation' | 'unrouted' | 'filed' | 'dismissed' | 'error'
  filename: string
  document_type: string | null
  confidence: number
  confidence_tier: 'auto' | 'confirm' | 'manual' | null
  proposed_route: string | null
  proposed_ref: string | null
  proposed_book_id: number | null
  proposed_employee_id: string | null
  proposed_employee_name_en: string | null
  proposed_employee_name_ar: string | null
  match_score: number | null
  ledger_entry_id: number | null
  email_sender: string | null
  email_subject: string | null
  error_detail: string | null
  fields: Record<string, string>
  candidates: EmployeeCandidate[]
}

export interface ScanInboxListResponse {
  items: ScanInboxItem[]
  total: number
}

export interface ScanInboxCount {
  awaiting_confirmation: number
  unrouted: number
  total: number
}

// Phase 4 LAN — Notification counts (SSE + JSON safety-poll).
// Hand-mirrored from backend/app/schemas/notifications.py NotificationCounts.
export interface NotificationCounts {
  approvals: number
  leaves: number
  scans: number
  emails: number
}

// Phase 05 — Books
// ``attachment_paths`` (Task 1 / migration 0023) is not yet in api.types.ts;
// hand-merge it until ``npm run gen:api`` regenerates the schema.
export type BookCreate = components['schemas']['BookCreate']
export type BookUpdate = components['schemas']['BookUpdate']
export type BookListResponse = components['schemas']['BookListResponse']
export type BookCategoryRead = components['schemas']['BookCategoryRead']
// `kind`, `seen_at`, `assignee_name` are now in the generated schema (gen:api,
// Task 8).  Retain the augment without re-narrowing `kind` so it stays
// compatible with the `string` the generated schema carries.
export type BookApprovalStepRead = components['schemas']['BookApprovalStepRead'] & {
  seen_at?: string | null
  assignee_name?: string | null
}
export type ApproverOptionRead = components['schemas']['ApproverOptionRead']

// Book versioning. The generated schema (regenerated for the signing slice)
// now carries `versions` on BookRead with `manager_sig_embedded` +
// `signed_pdf_url`, plus `submitted_by_g`/`attachment_paths`. These are plain
// re-exports now — the earlier hand-mirroring is no longer needed.
export type BookVersionRead = components['schemas']['BookVersionRead']

// `imported_doc` (v3-imported records served from the employee vault) is
// hand-merged until `npm run gen:api` folds it into the generated schema.
export interface ImportedDocRead {
  pdf_url?: string | null
  download_url: string
  filename: string
  format: string
}
// `your_step_kind` is now in the generated schema (gen:api, Task 8); drop the
// hand-narrowed augment so the wider `string | null` from the schema stays intact.
export type BookRead = components['schemas']['BookRead'] & {
  doc_manager_user_id?: number | null
  doc_manager_name?: string | null
  doc_manager_has_signature?: boolean
  imported_doc?: ImportedDocRead | null
}

// Annotation overlay (Slice 3). Hand-typed mirror of schemas.book.BookAnnotationRead
// until gen:api folds it into the generated schema.
export interface BookAnnotationRead {
  id: number
  version_id: number
  page: number
  kind: 'pin' | 'highlight'
  geometry: Record<string, number>
  comment: string | null
  author_user_id: number | null
  author_name: string | null
  created_at: string
}

// Approval — hand-mirrored from backend/app/schemas/books.py (submit request).
// BookApproverSpec deleted (Task 10): single approver_user_id + reviewer_user_ids replaces the array.
export interface BookSubmitRequest {
  priority: 'Normal' | 'High'
  approver_user_id?: number | null
  reviewer_user_ids?: number[]
}
// Approval == signing: the `/approve` endpoint is gone (replaced by `/sign`),
// so `decideBook` only does reject/return/note now.
export type BookDecideAction = 'reject' | 'return' | 'note'
// Reviewer decision — `reviewed` = approved as reviewer; `changes_requested` = reviewer asks for changes.
export type BookReviewDecision = 'reviewed' | 'changes_requested'

// General-book recipients (forms-fix) — hand-mirrored until gen:api picks up the new schema.
export interface RecipientRead {
  id: number
  name: string
  name_ar: string | null
}
export interface RecipientCreate {
  name: string
  name_ar?: string | null
}

// Phase 04 — generated types from api.types.ts
export type ManagerRead = components['schemas']['ManagerRead'] & {
  user_id?: number | null
  user_name?: string | null
}
export type SubmitterRead = components['schemas']['SubmitterRead']
export type TemplateMeta = components['schemas']['TemplateMeta']
export type TemplateListResponse = components['schemas']['TemplateListResponse']
export type DocumentRead = components['schemas']['DocumentRead']
export type DocumentGenerateRequest = components['schemas']['DocumentGenerateRequest'] & {
  /** feat/book-drawer-versioning — when set, the generated document is recorded
   * as a revision of this book (backend: revise_of_book_id param). */
  revise_of_book_id?: number
}
export type DocumentGenerateResponse = components['schemas']['DocumentGenerateResponse']
export type JobDocumentItem = components['schemas']['JobDocumentItem']
export type JobStatusResponse = components['schemas']['JobStatusResponse']

// Forms signing paths & required attachments (2026-06-11). `signing_path` +
// `attachment_slots` ride on the templates list/detail responses;
// `GenerateAttachmentSpec[]` goes out on `DocumentGenerateRequest.attachments`;
// `StagedAttachmentRead` comes back from `POST /documents/attachments/stage`.
export type SigningPath = components['schemas']['TemplateMeta']['signing_path']
export type AttachmentSlotRead = components['schemas']['AttachmentSlotRead']
export type GenerateAttachmentSpec = components['schemas']['GenerateAttachmentSpec']
export type StagedAttachmentRead = components['schemas']['StagedAttachmentRead']

// Phase 12 — Dashboard
// Hand-mirrored until backend lands and `npm run gen:api` picks it up.
export interface DashboardOnLeaveItem {
  employee_id: string
  employee_name_en: string
  employee_name_ar: string | null
  leave_id: number
  leave_type: string
  start_date: string
  end_date: string
}

export interface DashboardUpcomingItem {
  employee_id: string
  employee_name_en: string
  employee_name_ar: string | null
  leave_id: number
  leave_type: string
  end_date: string
  days_remaining: number
}

export interface DashboardRecentDocument {
  id: number
  employee_id: string
  employee_name_en: string
  employee_name_ar: string | null
  template_id: string
  ref_number: string | null
  role: string | null
  created_at: string
}

export interface DashboardRecentLedger {
  id: number
  entry_date: string
  direction: string
  channel: string
  counterparty: string
  subject: string
  related_employee_id: string | null
  related_employee_name_en: string | null
  related_employee_name_ar: string | null
  created_at: string
}

/**
 * Email sync snapshot embedded in the dashboard summary. Drives the
 * `email_sync_status` widget. Hand-typed here until openapi-typescript
 * regenerates against the new backend response shape — keep in sync with
 * `backend/app/schemas/dashboard.py::EmailSyncSnapshot`.
 */
export interface DashboardEmailSync {
  /** ISO-8601 timestamp of the last successful sync, or `null` if never synced. */
  last_synced_at: string | null
  /** Whether email sync is configured (account exists + has credentials). */
  enabled: boolean
  /** Configured cadence in minutes. `0` means scheduled sync is off. */
  interval_minutes: number
  /** Count of emails imported today (per local calendar day). */
  incoming_today: number
}

export interface DashboardSummary {
  totals: {
    employees_active: number
    on_leave_today: number
    present_today: number
    forms_this_month: number
    open_violations_count: number
    draft_count: number
    book_draft_count: number
  }
  on_leave_today: DashboardOnLeaveItem[]
  upcoming_leave_ends: DashboardUpcomingItem[]
  recent_documents: DashboardRecentDocument[]
  recent_ledger: DashboardRecentLedger[]
  /** Phase 18 — email sync widget payload. Always present (backend always returns it). */
  email_sync: DashboardEmailSync
}

interface ErrorEnvelope {
  error?: {
    code?: string
    message?: string
    details?: Record<string, unknown>
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Human-readable message for any thrown value — the ApiError message when it is
 * one, else the stringified error. Replaces the `x instanceof ApiError ?
 * x.message : String(x)` idiom that was copy-pasted across the app. */
export function apiErrorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : String(err)
}

const BASE = '/api/v1'

async function unwrap<T>(res: Response): Promise<T> {
  if (res.status === 204) {
    return undefined as T
  }
  const text = await res.text()
  const parsed = text ? (JSON.parse(text) as unknown) : undefined
  if (!res.ok) {
    const envelope = (parsed as ErrorEnvelope | undefined)?.error
    throw new ApiError(
      res.status,
      envelope?.code ?? `HTTP_${res.status}`,
      envelope?.message ?? res.statusText,
      envelope?.details ?? {},
    )
  }
  return parsed as T
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // `same-origin` carries the httpOnly `gssg_session` cookie through the Vite
  // proxy (dev) and the pywebview origin (packaged) so auth survives requests.
  const init: RequestInit = { method, cache: 'no-store', credentials: 'same-origin' }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return unwrap<T>(await fetch(`${BASE}${path}`, init))
}

async function multipart<T>(path: string, form: FormData, method = 'POST'): Promise<T> {
  return unwrap<T>(
    await fetch(`${BASE}${path}`, { method, body: form, credentials: 'same-origin' }),
  )
}

export interface ListEmployeesParams {
  q?: string
  status?: EmployeeStatus
  department?: string
  limit?: number
  offset?: number
}

function qs(params: Record<string, unknown>): string {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') usp.set(k, String(v))
  }
  const s = usp.toString()
  return s ? `?${s}` : ''
}

export const api = {
  // --- system ---
  health: () => request<HealthResponse>('GET', '/system/health'),

  // --- employees ---
  listEmployees: (params: ListEmployeesParams = {}) =>
    request<EmployeeListResponse>('GET', `/employees${qs({ ...params })}`),
  getEmployee: (id: string) => request<EmployeeRead>('GET', `/employees/${encodeURIComponent(id)}`),
  getEmployeeDetail: (id: string) =>
    request<EmployeeDetailRead>('GET', `/employees/${encodeURIComponent(id)}/detail`),
  getEmployeesCompleteness: () =>
    request<CompletenessSummaryOut>('GET', '/employees/completeness'),
  createEmployee: (payload: EmployeeCreate) =>
    request<EmployeeRead>('POST', '/employees', payload),
  updateEmployee: (id: string, payload: EmployeeUpdate) =>
    request<EmployeeRead>('PATCH', `/employees/${encodeURIComponent(id)}`, payload),

  /** POST /employees/{id}/passport/extract — OCR-extract passport number from
   * the employee's passport vault scan. Never writes; caller must PATCH to save. */
  extractPassport: (employeeId: string) =>
    request<PassportSuggestion>('POST', `/employees/${encodeURIComponent(employeeId)}/passport/extract`),

  // --- duty locations & internal transfers ---
  transferDuty: (body: DutyTransferRequest) =>
    request<DutyTransferResult>('POST', '/duty/transfer', body),

  // --- leaves (employee sub-resource, read-only) ---
  listEmployeeLeaves: (employeeId: string) =>
    request<LeaveRead[]>('GET', `/employees/${encodeURIComponent(employeeId)}/leaves`),

  // --- leaves (Phase 06 — standalone collection) ---
  listLeaves: (params: {
    employee_id?: string
    q?: string
    status?: LeaveStatus
    leave_type?: string
    from_date?: string
    to_date?: string
    include_deleted?: boolean
    limit?: number
    offset?: number
  } = {}) => request<LeaveListResponse>('GET', `/leaves${qs({ ...params })}`),
  getLeave: (id: number) => request<LeaveRead>('GET', `/leaves/${id}`),
  updateLeave: (id: number, body: LeaveUpdate) =>
    request<LeaveRead>('PATCH', `/leaves/${id}`, body),
  deleteLeave: (id: number) => request<void>('DELETE', `/leaves/${id}`),
  createLeave: (body: LeaveCreate) => request<LeaveRead>('POST', '/leaves', body),

  uploadLeaveCertificate: (id: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return multipart<LeaveRead>(`/leaves/${id}/certificate`, form)
  },

  fileLeaveReturn: (id: number, body: LeaveReturnBody) =>
    request<LeaveRead>('POST', `/leaves/${id}/return`, body),

  /** Fetch the NS certificate IDM-safely (base64 → Blob) for viewing. */
  fetchLeaveCertificateBlob: async (id: number): Promise<Blob> => {
    const res = await fetch(`${BASE}/leaves/${id}/certificate?encoding=base64`, {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (!res.ok) {
      throw new ApiError(
        res.status,
        `HTTP_${res.status}`,
        res.statusText || 'Failed to load certificate',
      )
    }
    const b64 = (await res.text()).trim()
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    return new Blob([bytes])
  },

  getLeaveBalance: (employeeId: string, asOf?: string) =>
    request<LeaveBalanceRead>(
      'GET',
      `/employees/${encodeURIComponent(employeeId)}/leave-balance${qs({ as_of: asOf })}`,
    ),

  // --- violations ---
  listViolations: (employeeId: string) =>
    request<ViolationRead[]>('GET', `/employees/${encodeURIComponent(employeeId)}/violations`),
  createViolation: (employeeId: string, payload: ViolationCreate) =>
    request<ViolationRead>(
      'POST',
      `/employees/${encodeURIComponent(employeeId)}/violations`,
      payload,
    ),
  updateViolation: (violationId: number, payload: ViolationUpdate) =>
    request<ViolationRead>('PATCH', `/violations/${violationId}`, payload),
  deleteViolation: (violationId: number) =>
    request<void>('DELETE', `/violations/${violationId}`),

  // --- vault ---
  getVault: (employeeId: string) =>
    request<VaultTree>('GET', `/employees/${encodeURIComponent(employeeId)}/vault`),
  uploadVaultFile: (employeeId: string, kind: VaultKind, file: File) => {
    const form = new FormData()
    form.append('kind', kind)
    form.append('file', file)
    return multipart<VaultEntry>(`/employees/${encodeURIComponent(employeeId)}/vault/upload`, form)
  },
  deleteVaultFile: (employeeId: string, kind: VaultKind, filename: string) =>
    request<void>(
      'DELETE',
      `/employees/${encodeURIComponent(employeeId)}/vault/${kind}/${encodeURIComponent(filename)}`,
    ),
  vaultPreviewUrl: (employeeId: string, kind: VaultKind, filename: string) =>
    `${BASE}/employees/${encodeURIComponent(employeeId)}/vault/${kind}/${encodeURIComponent(filename)}/preview`,
  vaultDownloadUrl: (employeeId: string, kind: VaultKind, filename: string) =>
    `${BASE}/employees/${encodeURIComponent(employeeId)}/vault/${kind}/${encodeURIComponent(filename)}/download`,
  vaultBase64Url: (employeeId: string, kind: VaultKind, filename: string) =>
    `${BASE}/employees/${encodeURIComponent(employeeId)}/vault/${kind}/${encodeURIComponent(filename)}/download?encoding=base64`,

  // --- signature ---
  uploadSignature: (employeeId: string, png: Blob) => {
    const form = new FormData()
    form.append('file', png, 'signature.png')
    return multipart<{ path: string; filename: string }>(
      `/employees/${encodeURIComponent(employeeId)}/signature`,
      form,
    )
  },

  /** Saved signature for a specific employee as a PNG data URL (+ mtime).
   *  Returns null when none is on file (404). Mirrors getSavedSignature's
   *  base64 IDM workaround. */
  getEmployeeSignature: async (
    employeeId: string,
  ): Promise<{ dataUrl: string; updatedAt: string | null } | null> => {
    const res = await fetch(
      `${BASE}/employees/${encodeURIComponent(employeeId)}/signature?encoding=base64`,
      { method: 'GET', cache: 'no-store', credentials: 'same-origin' },
    )
    if (res.status === 404) return null
    if (!res.ok) {
      throw new ApiError(
        res.status,
        `HTTP_${res.status}`,
        res.statusText || 'Failed to load signature',
      )
    }
    const b64 = (await res.text()).trim()
    if (!b64) return null
    return {
      dataUrl: `data:image/png;base64,${b64}`,
      updatedAt: res.headers.get('X-Signature-Updated'),
    }
  },

  deleteEmployeeSignature: (employeeId: string) =>
    request<void>(
      'DELETE',
      `/employees/${encodeURIComponent(employeeId)}/signature`,
    ),

  // --- employee photo (avatar) ---
  uploadEmployeePhoto: (employeeId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return multipart<{ filename: string; size_bytes: number; photo_version: string }>(
      `/employees/${encodeURIComponent(employeeId)}/photo`,
      form,
    )
  },
  deleteEmployeePhoto: (employeeId: string) =>
    request<void>('DELETE', `/employees/${encodeURIComponent(employeeId)}/photo`),

  // --- signing signature (per-user, embedded when approving/signing a book) ---
  // Separate from the employee-vault signature above. Backed by
  // POST/DELETE /auth/me/signature; `GET /auth/me` reports `has_signature`.
  uploadMySignature: (png: Blob) => {
    const form = new FormData()
    form.append('file', png, 'signature.png')
    return multipart<void>('/auth/me/signature', form)
  },
  deleteMySignature: () => request<void>('DELETE', '/auth/me/signature'),

  /**
   * Fetch the signed-in user's saved signature as a PNG data URL.
   *
   * Round 4: backs the saved-signature preview inside SignatureField. The
   * backend (Agent 1 of Round 4) returns the bytes base64-encoded with
   * `text/plain` Content-Type when `?encoding=base64` is set — same IDM
   * workaround the documents endpoint uses (Internet Download Manager
   * intercepts `image/png` responses on the dev box).
   *
   * Returns `null` when no signature is on file (the endpoint returns 404
   * in that case). Any other failure throws.
   */
  getSavedSignature: async (): Promise<string | null> => {
    const res = await fetch(`${BASE}/signatures/me?encoding=base64`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (res.status === 404) return null
    if (!res.ok) {
      throw new ApiError(
        res.status,
        `HTTP_${res.status}`,
        res.statusText || 'Failed to load signature',
      )
    }
    const b64 = (await res.text()).trim()
    if (!b64) return null
    return `data:image/png;base64,${b64}`
  },

  /**
   * Render the current user's signature at the given size/boldness.
   *
   * Used for the live preview in the Settings "Signature appearance" block
   * (Task 6). Returns 404 when no signature is on file (caller shows an
   * empty state). Any other non-2xx throws ApiError.
   */
  previewSignature: async (body: {
    size_mm: number
    boldness: number
  }): Promise<{ data_url: string; size_mm: number; boldness: number }> => {
    const res = await fetch(`${BASE}/signatures/preview`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new ApiError(
        res.status,
        `HTTP_${res.status}`,
        res.statusText || 'Preview failed',
      )
    }
    return (await res.json()) as { data_url: string; size_mm: number; boldness: number }
  },

  // --- managers (Phase 04) ---
  listManagers: () => request<ManagerRead[]>('GET', '/managers'),
  linkManagerAccount: (id: number, userId: number | null) =>
    request<ManagerRead>('PATCH', `/managers/${id}`, { user_id: userId }),

  // --- submitters (Phase 04) ---
  listSubmitters: () => request<SubmitterRead[]>('GET', '/submitters'),

  // --- templates (Phase 04) ---
  listTemplates: () => request<TemplateListResponse>('GET', '/templates'),

  // getTemplateFields remaps `key` → `id` so field components can use `field.id`
  getTemplateFields: async (templateId: string): Promise<{
    meta: TemplateMeta
    needs_manager: boolean
    needs_submitter: boolean
    signing_path: SigningPath
    attachment_slots: AttachmentSlotRead[]
    fields: Array<{
      id: string
      label_en: string
      label_ar: string
      type: string
      required: boolean
      options?: string[] | null
      default?: string | null
      group?: string | null
    }>
  }> => {
    const raw = await request<{
      meta: TemplateMeta
      // Forms signing paths & attachments (2026-06-11): the detail response
      // carries the form policy at TOP LEVEL (alongside meta, which echoes
      // signing_path too — the top-level one is the contract).
      signing_path: SigningPath
      attachment_slots: AttachmentSlotRead[]
      fields: Array<{ key: string; label_en: string; label_ar: string; type: string; required: boolean; options?: string[] | null; default?: string | null; group?: string | null }>
    }>('GET', `/templates/${encodeURIComponent(templateId)}/fields`)
    return {
      meta: raw.meta,
      // Backend _fields.json embeds needs_manager/needs_submitter at the meta level.
      // They are not currently part of the generated TemplateDetailResponse, so we
      // derive them by checking if the fields list contains those types.
      needs_manager: raw.fields.some((f) => f.type === 'manager_picker'),
      needs_submitter: raw.fields.some((f) => f.type === 'submitter_picker'),
      signing_path: raw.signing_path,
      attachment_slots: raw.attachment_slots ?? [],
      fields: raw.fields.map((f) => ({ ...f, id: f.key })),
    }
  },

  // --- books (Phase 05) ---
  listBooks: (params: {
    category_id?: string
    direction?: 'incoming' | 'outgoing'
    approval_state?: 'none' | 'pending' | 'approved' | 'returned' | 'rejected'
    q?: string
    from_date?: string
    to_date?: string
    include_deleted?: boolean
    limit?: number
    offset?: number
  } = {}) => request<BookListResponse>('GET', `/books${qs({ ...params })}`),
  getBook: (id: number) => request<BookRead>('GET', `/books/${id}`),
  /** Resolve a book by its ref_number (e.g. "GS-0005") — backs the ledger
   * book-chip deep-link. 404s when no live book carries the ref. */
  getBookByRef: (ref: string) =>
    request<BookRead>('GET', `/books/by-ref/${encodeURIComponent(ref)}`),
  /** GET /books/{id}/versions/{vid}/fields — raw stored fields for revise-mode
   * prefill (the detail payload only exposes has_fields). */
  getBookVersionFields: (bookId: number, versionId: number): Promise<{ fields: Record<string, unknown> }> =>
    request<{ fields: Record<string, unknown> }>('GET', `/books/${bookId}/versions/${versionId}/fields`),
  createBook: (body: BookCreate) => request<BookRead>('POST', '/books', body),
  updateBook: (id: number, body: BookUpdate) =>
    request<BookRead>('PATCH', `/books/${id}`, body),
  deleteBook: (id: number) => request<void>('DELETE', `/books/${id}`),
  listBookCategories: () => request<BookCategoryRead[]>('GET', '/book-categories'),

  // --- books approval (feat/mobile-and-approval) ---
  /** GET /books/awaiting — books pending the signed-in user's decision. */
  listAwaitingBooks: () => request<BookRead[]>('GET', '/books/awaiting'),
  /** GET /books/approvers — valid approver candidates for the submit picker. */
  listApprovers: () => request<ApproverOptionRead[]>('GET', '/books/approvers'),
  /** POST /books/{id}/submit — submit a draft book for approval. */
  submitBook: (id: number, body: BookSubmitRequest) =>
    request<BookRead>('POST', `/books/${id}/submit`, body),
  /** POST /books/{id}/{action} — decide on a book (reject/return/note). */
  decideBook: (id: number, action: BookDecideAction, note?: string | null) =>
    request<BookRead>('POST', `/books/${id}/${action}`, { note: note ?? null }),
  /** POST /books/{id}/sign — approval == signing. Only the assigned pending
   * signer (a manager with a signature on file) can sign; embeds their
   * signature and marks the book approved. Error codes: NO_SIGNATURE,
   * SIGNATURE_MISSING, NOT_YOUR_STEP. */
  signBook: (id: number) => request<BookRead>('POST', `/books/${id}/sign`),
  /** POST /books/{id}/review — submit a reviewer decision (`reviewed` or
   * `changes_requested`) with an optional note. */
  reviewBook: (id: number, decision: BookReviewDecision, note?: string | null) =>
    request<BookRead>('POST', `/books/${id}/review`, { decision, note: note ?? null }),
  /** POST /books/{id}/seen — mark the book as seen by the current user (idempotent). */
  markBookSeen: (id: number) => request<void>('POST', `/books/${id}/seen`),
  /** GET /books/reviewer-candidates — list users eligible to be added as reviewers. */
  listReviewerCandidates: () => request<ApproverOptionRead[]>('GET', '/books/reviewer-candidates'),
  /** POST /books/{id}/reviewers — add reviewer user-ids to the book. */
  addBookReviewers: (id: number, userIds: number[]) =>
    request<BookRead>('POST', `/books/${id}/reviewers`, { user_ids: userIds }),
  /** DELETE /books/{id}/reviewers/{userId} — remove a reviewer from the book. */
  removeBookReviewer: (id: number, userId: number) =>
    request<BookRead>('DELETE', `/books/${id}/reviewers/${userId}`),
  /** GET version annotations (pins + highlights) for the record-screen overlay. */
  listBookAnnotations: (bookId: number, versionId: number) =>
    request<BookAnnotationRead[]>(
      'GET',
      `/books/${bookId}/versions/${versionId}/annotations`,
    ),
  /** POST a new annotation (signing manager marking during review). */
  createBookAnnotation: (
    bookId: number,
    versionId: number,
    body: { page: number; kind: 'pin' | 'highlight'; geometry: Record<string, number>; comment: string },
  ) =>
    request<BookAnnotationRead>(
      'POST',
      `/books/${bookId}/versions/${versionId}/annotations`,
      body,
    ),
  /** DELETE an annotation (author-only, 204). */
  deleteBookAnnotation: (bookId: number, versionId: number, annotationId: number) =>
    request<void>(
      'DELETE',
      `/books/${bookId}/versions/${versionId}/annotations/${annotationId}`,
    ),

  // --- intake (Phase C — Universal Intake Drop-zone) ---
  /** POST /api/v1/intake — classify a scanned file. Returns a discriminated
   * result: ``returned_form`` when the scan matches a stamped Book ref, or
   * ``external`` when it's an inbound document to be routed to a consumer form.
   * Raises ``ApiError`` on non-2xx; a 503 means Tesseract is not available. */
  postIntake: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return multipart<IntakeResponse>('/intake', form)
  },
  /** POST /api/v1/books/{bookId}/attachments — attach a scanned copy to a Book.
   * `asSigned=true` records it as the signed copy and (for none/pending/awaiting_scan)
   * approves the record; otherwise it is filed as a plain attachment. */
  addBookAttachment: (bookId: number, file: File, asSigned = false) => {
    const form = new FormData()
    form.append('file', file)
    form.append('as_signed', asSigned ? 'true' : 'false')
    return multipart<BookRead>(`/books/${bookId}/attachments`, form)
  },
  /** DELETE /books/{id}/attachments/{index} — remove a plain attachment (undo a
   * wrongly-uploaded scan). books.manage. */
  deleteBookAttachment: (bookId: number, index: number) =>
    request<BookRead>('DELETE', `/books/${bookId}/attachments/${index}`),
  /** PUT /books/{id}/attachments/{index} — replace a plain attachment's bytes,
   * keeping its index. books.manage. */
  replaceBookAttachment: (bookId: number, index: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return multipart<BookRead>(`/books/${bookId}/attachments/${index}`, form, 'PUT')
  },
  /** PUT /books/{id}/signed-copy — replace the signed copy's bytes, keeping the
   * record approved. books.manage. */
  replaceSignedCopy: (bookId: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return multipart<BookRead>(`/books/${bookId}/signed-copy`, form, 'PUT')
  },
  /** DELETE /books/{id}/signed-copy — unfile the signed copy and revert the
   * record's approval state. books.manage. */
  unfileSignedCopy: (bookId: number) =>
    request<BookRead>('DELETE', `/books/${bookId}/signed-copy`),

  // --- scan inbox ---
  /** List scan-inbox items, optionally filtered by `state`. */
  listScanInbox: (params: { state?: string } = {}) =>
    request<ScanInboxListResponse>('GET', `/scan-inbox${qs({ ...params })}`),
  /** Inline document URL for a scan item (served by backend). */
  scanDocumentUrl: (id: number) => `${BASE}/scan-inbox/${id}/document`,
  /** Pending-action counts for the scan inbox badge. */
  getScanInboxCount: () => request<ScanInboxCount>('GET', '/scan-inbox/count'),
  /** Confirm an auto-classified item (moves it to `filed`). */
  confirmScanItem: (id: number) =>
    request<ScanInboxItem>('POST', `/scan-inbox/${id}/confirm`),
  /** Manually route an unrouted item to an employee or book. */
  routeScanItem: (id: number, body: { employee_id?: string; book_id?: number }) =>
    request<ScanInboxItem>('POST', `/scan-inbox/${id}/route`, body),
  /** Dismiss an item (mark as not actionable). */
  dismissScanItem: (id: number) =>
    request<ScanInboxItem>('POST', `/scan-inbox/${id}/dismiss`),
  /** Undo a dismiss or confirm — returns item to its previous state. */
  undoScanItem: (id: number) =>
    request<ScanInboxItem>('POST', `/scan-inbox/${id}/undo`),

  // --- ledger (Phase 07) ---
  listLedger: (params: {
    from_date?: string
    to_date?: string
    direction?: LedgerDirection
    channel?: LedgerChannel
    counterparty?: string
    q?: string
    tag?: string
    related_employee_id?: string
    related_book_id?: number
    include_deleted?: boolean
    /** Phase 15 — restrict to entries with at least one attachment. */
    has_attachment?: boolean
    /** Phase 15 — entries on or after this ISO date (inclusive). */
    since?: string
    /** Phase 16 — when true, draft entries (tag=draft) are included. The list
     * endpoint defaults to excluding them. */
    include_drafts?: boolean
    /** Phase 6 — 'all' (admin only) widens to the whole-office inbox; default own. */
    scope?: 'mine' | 'all'
    limit?: number
    offset?: number
  } = {}) => request<LedgerListResponse>('GET', `/ledger${qs({ ...params })}`),
  getLedgerEntry: (id: number) => request<LedgerEntryRead>('GET', `/ledger/${id}`),
  listLedgerThread: (id: number, limit = 50) =>
    request<LedgerListItem[]>('GET', `/ledger/${id}/thread${qs({ limit })}`),
  createLedgerEntry: (body: LedgerEntryCreate) =>
    request<LedgerEntryRead>('POST', '/ledger', body),
  updateLedgerEntry: (id: number, body: LedgerEntryUpdate) =>
    request<LedgerEntryRead>('PATCH', `/ledger/${id}`, body),
  deleteLedgerEntry: (id: number) => request<void>('DELETE', `/ledger/${id}`),
  listLedgerCounterparties: (q?: string, limit?: number) =>
    request<string[]>('GET', `/ledger/counterparties${qs({ q, limit })}`),
  uploadLedgerAttachment: (id: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return multipart<LedgerEntryRead>(`/ledger/${id}/attachments`, form)
  },
  // Phase 15
  toggleLedgerStar: (id: number) =>
    request<LedgerEntryRead>('POST', `/ledger/entries/${id}/star`),
  ledgerAttachmentsZipUrl: (id: number) =>
    `${BASE}/ledger/entries/${id}/attachments.zip`,
  /** URL for a single attachment, addressed by its `attachment_paths` index
   * (keeps non-ASCII/spaced filenames out of the path). `inline: true` asks the
   * backend to serve it `Content-Disposition: inline` so preview can render it. */
  ledgerAttachmentUrl: (
    id: number,
    index: number,
    opts?: { inline?: boolean; base64?: boolean },
  ) => {
    const qs = opts?.base64
      ? '?encoding=base64'
      : opts?.inline
        ? '?disposition=inline'
        : ''
    return `${BASE}/ledger/${id}/attachments/by-index/${index}${qs}`
  },

  // --- Phase 16: FTS5 search ---
  searchLedger: (q: string, limit = 50, scope?: 'mine' | 'all') =>
    request<LedgerSearchResponse>('GET', `/ledger/search${qs({ q, limit, scope })}`),

  // --- Phase 17: read state (NavBell numeric badge) ---
  /** Phase 17 — newest N unread incoming entries for the NavBell popover. */
  getLedgerUnreadRecent: (limit = 5) =>
    request<UnreadRecentResponse>('GET', `/ledger/unread-recent${qs({ limit })}`),
  markLedgerEntryRead: (id: number) =>
    request<LedgerEntryRead>('POST', `/ledger/entries/${id}/mark-read`),
  markAllLedgerRead: () =>
    request<LedgerMarkAllReadResult>('POST', '/ledger/mark-all-read'),

  // --- Ledger→Outlook Phase 4: automated Correspondence Log + Inbox badge ---
  /** Shared automated Correspondence Log; filter by `category_id` for an
   * accordion sub-folder. */
  getLedgerLog: (
    params: { category_id?: number; limit?: number; offset?: number } = {},
  ) =>
    request<CorrespondenceLogResponse>('GET', `/ledger/log${qs({ ...params })}`),
  /** Correspondence-log categories — note: gated `settings.edit` server-side, so
   * non-admins get 403; the rail derives sub-items from the log when so. */
  getCorrespondenceCategories: () =>
    request<CorrespondenceCategoryRead[]>('GET', '/correspondence/categories'),
  /** Create a (non-system) correspondence category — gated `settings.edit`. */
  createCorrespondenceCategory: (body: CorrespondenceCategoryCreate) =>
    request<CorrespondenceCategoryRead>('POST', '/correspondence/categories', body),
  /** Delete a category — the backend guards `system=True` (422/409). Used only
   * after the UI checks `cat.system` first. */
  deleteCorrespondenceCategory: (id: number) =>
    request<void>('DELETE', `/correspondence/categories/${id}`),
  // --- Ledger→Outlook Phase 7: auto-capture rules CRUD (settings.edit) ---
  /** List the Correspondence-Log auto-capture rules. */
  getCorrespondenceRules: () =>
    request<CorrespondenceRuleRead[]>('GET', '/correspondence/rules'),
  /** Create an auto-capture rule. */
  createCorrespondenceRule: (body: CorrespondenceRuleCreate) =>
    request<CorrespondenceRuleRead>('POST', '/correspondence/rules', body),
  /** Patch a rule (e.g. toggle `enabled`, re-target its category). */
  updateCorrespondenceRule: (id: number, body: CorrespondenceRuleUpdate) =>
    request<CorrespondenceRuleRead>('PATCH', `/correspondence/rules/${id}`, body),
  /** Delete a rule. */
  deleteCorrespondenceRule: (id: number) =>
    request<void>('DELETE', `/correspondence/rules/${id}`),
  /** Unread count for the personal mailbox (drives the Inbox folder badge). */
  getLedgerUnreadCount: (scope?: 'mine' | 'all') =>
    request<UnreadCountResponse>('GET', `/ledger/unread-count${qs({ scope })}`),
  /** Read-only auto-log record for a Correspondence-Log row. */
  getLedgerLogRecord: (id: number) =>
    request<CorrespondenceLogRecord>('GET', `/ledger/log/${id}`),

  // --- Ledger→Outlook Phase 2: address book ---
  listLedgerContacts: () =>
    request<AddressBookContactRead[]>('GET', '/ledger/contacts'),
  addLedgerContact: (body: { display_name: string; address: string }) =>
    request<AddressBookContactRead>('POST', '/ledger/contacts', body),
  deleteLedgerContact: (id: number) =>
    request<void>('DELETE', `/ledger/contacts/${id}`),

  // --- Ledger compose: recipient (distribution) lists ---
  listRecipientLists: () =>
    request<RecipientListRead[]>('GET', '/ledger/recipient-lists'),
  createRecipientList: (body: RecipientListCreate) =>
    request<RecipientListRead>('POST', '/ledger/recipient-lists', body),
  updateRecipientList: (id: number, body: RecipientListUpdate) =>
    request<RecipientListRead>('PATCH', `/ledger/recipient-lists/${id}`, body),
  deleteRecipientList: (id: number) =>
    request<void>('DELETE', `/ledger/recipient-lists/${id}`),

  // --- Phase 16: drafts ---
  createDraft: (body: DraftWrite) =>
    request<LedgerEntryRead>('POST', '/ledger/drafts', body),
  updateDraft: (id: number, body: DraftWrite) =>
    request<LedgerEntryRead>('PATCH', `/ledger/drafts/${id}`, body),
  /** Upsert helper — POST when id is null, PATCH otherwise. */
  upsertDraft: (id: number | null, body: DraftWrite) =>
    id == null
      ? request<LedgerEntryRead>('POST', '/ledger/drafts', body)
      : request<LedgerEntryRead>('PATCH', `/ledger/drafts/${id}`, body),
  deleteDraft: (id: number) => request<void>('DELETE', `/ledger/drafts/${id}`),
  sendDraft: (id: number) =>
    request<LedgerEntryRead>('POST', `/ledger/drafts/${id}/send`),

  // --- Phase 16: send attachment to vault ---
  sendAttachmentToVault: (
    entryId: number,
    attachmentIndex: number,
    employeeId: string,
    kind: VaultKind,
  ) =>
    request<VaultEntry>(
      'POST',
      `/ledger/entries/${entryId}/attachments/${attachmentIndex}/send-to-vault`,
      { employee_id: employeeId, kind },
    ),

  // --- settings (Phase 08) ---
  getSettings: () => request<AppSettingsRead>('GET', '/settings'),
  updateSettings: (body: AppSettingsUpdate) =>
    request<AppSettingsRead>('PATCH', '/settings', body),

  // --- system (Phase 08) ---
  getSystemInfo: () => request<SystemInfo>('GET', '/system/info'),
  checkForUpdates: () => request<UpdateCheckResult>('GET', '/system/update-check'),
  setAdminKey: (enabled: boolean) =>
    request<AdminKeyResponse>('POST', '/system/admin-key', { enabled }),
  /** Post a frontend crash report to POST /system/crash-report.
   * Payload matches `CrashReportPayload` in backend/app/schemas/crash.py. */
  postCrashReport: (payload: {
    message: string
    stack?: string | null
    browser?: string | null
    timestamp?: string | null
    severity?: 'error' | 'warning'
  }) => request<{ report_id: string; path: string }>('POST', '/system/crash-report', payload),

  // --- migration (Phase 09) ---
  getMigrationStatus: () => request<MigrationStatus>('GET', '/system/migration-status'),
  migrateV3: (body: MigrateRequest) => request<MigrationResult>('POST', '/system/migrate-v3', body),

  // --- submitters CRUD (Phase 08) ---
  createSubmitter: (body: SubmitterCreate) =>
    request<SubmitterRead>('POST', '/submitters', body),
  deleteSubmitter: (id: number) => request<void>('DELETE', `/submitters/${id}`),

  // --- general-book recipients (forms-fix) ---
  listRecipients: () => request<RecipientRead[]>('GET', '/general-book/recipients'),
  createRecipient: (body: RecipientCreate) =>
    request<RecipientRead>('POST', '/general-book/recipients', body),
  deleteRecipient: (id: number) => request<void>('DELETE', `/general-book/recipients/${id}`),

  // --- editor templates (Phase 10) ---
  listEditorTemplates: (params: { q?: string; include_deleted?: boolean; limit?: number; offset?: number } = {}) =>
    request<EditorTemplateListResponse>('GET', `/editor-templates${qs({ ...params })}`),
  getEditorTemplate: (id: number) =>
    request<EditorTemplateRead>('GET', `/editor-templates/${id}`),
  createEditorTemplate: (body: { name: string; html: string }) =>
    request<EditorTemplateRead>('POST', '/editor-templates', body),
  updateEditorTemplate: (id: number, body: { name?: string; html?: string }) =>
    request<EditorTemplateRead>('PATCH', `/editor-templates/${id}`, body),
  deleteEditorTemplate: (id: number) =>
    request<void>('DELETE', `/editor-templates/${id}`),

  // --- dashboard (Phase 12) ---
  getDashboardSummary: () => request<DashboardSummary>('GET', '/dashboard/summary'),

  // --- email integration (Phase 13) ---
  getEmailAccount: () => request<EmailAccountRead | null>('GET', '/email/account'),
  upsertEmailAccount: (body: EmailAccountUpsert) =>
    request<EmailAccountRead>('PUT', '/email/account', body),
  deleteEmailAccount: () => request<void>('DELETE', '/email/account'),
  testEmailConnection: () => request<void>('POST', '/email/test'),
  syncEmail: () => request<EmailSyncResult>('POST', '/email/sync'),
  getEmailSyncStatus: () => request<EmailSyncStatus>('GET', '/email/sync/status'),
  sendEmail: (body: EmailSendRequest, files: File[] = []) => {
    const form = new FormData()
    form.set('to', (body.to ?? []).join(','))
    form.set('cc', (body.cc ?? []).join(','))
    form.set('subject', body.subject)
    form.set('html', body.html)
    if (body.in_reply_to) form.set('in_reply_to', body.in_reply_to)
    if (body.references) form.set('references', body.references)
    if (body.use_signature !== undefined) {
      form.set('use_signature', body.use_signature ? 'true' : 'false')
    }
    for (const f of files) form.append('files', f)
    return multipart<EmailSendResult>('/email/send', form)
  },

  // --- email signature (Phase 15) ---
  // Stored as a field on AppSettingsRead/Update — exposed via the standard
  // GET /settings + PATCH /settings endpoints.
  getEmailSignature: async (): Promise<{ value: string }> => {
    const r = await request<{ email_signature?: string }>('GET', '/settings')
    return { value: r.email_signature ?? '' }
  },
  setEmailSignature: async (value: string): Promise<{ value: string }> => {
    const r = await request<{ email_signature?: string }>('PATCH', '/settings', { email_signature: value })
    return { value: r.email_signature ?? '' }
  },

  // --- identity (Phase 14) ---
  getIdentity: () => request<IdentityRead>('GET', '/identity/me'),
  transferAdmin: (employee_id: string) =>
    request<void>('POST', '/identity/transfer-admin', { employee_id }),

  // --- auth (multi-user login, 2026-05-24) ---
  authMe: () => request<SessionUser>('GET', '/auth/me'),
  login: (email: string, password: string) =>
    request<SessionUser>('POST', '/auth/login', { email, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  register: (payload: RegisterRequest) =>
    request<RegisterResult>('POST', '/auth/register', payload),
  verifyAuthPassword: (password: string) =>
    request<void>('POST', '/auth/verify-password', { password }),
  /** Link the signed-in user to their own employee record (G-number). Sets
   * `User.employee_id` — the authoritative identity source — so the link
   * picker actually flips `identity.linked`. Pass `null` to clear (admin). */
  linkMyEmployee: (employee_id: string | null) =>
    request<SessionUser>('POST', '/auth/me/link', { employee_id }),
  listAuthUsers: () => request<AdminUserRead[]>('GET', '/auth/users'),
  approveAuthUser: (id: number, role: string, employee_id?: string | null) =>
    request<AdminUserRead>('POST', `/auth/users/${id}/approve`, { role, employee_id }),
  rejectAuthUser: (id: number, reason?: string | null) =>
    request<AdminUserRead>('POST', `/auth/users/${id}/reject`, { reason }),
  resetAuthPassword: (id: number, password: string) =>
    request<AdminUserRead>('POST', `/auth/users/${id}/reset-password`, { password }),
  setAuthUserRole: (id: number, role: string) =>
    request<AdminUserRead>('PATCH', `/auth/users/${id}/role`, { role }),
  lockAuthUser: (id: number) => request<AdminUserRead>('POST', `/auth/users/${id}/lock`),
  unlockAuthUser: (id: number) => request<AdminUserRead>('POST', `/auth/users/${id}/unlock`),
  /** Set/clear the single-holder default-manager flag (forms signing paths,
   * 2026-06-11 §5). Enabling on one user clears any previous holder. */
  setDefaultManager: (userId: number, enabled: boolean) =>
    request<AdminUserRead>('POST', `/auth/users/${userId}/default-manager`, { enabled }),
  listAuthAudit: (limit = 50) =>
    request<AuditEntryRead[]>('GET', `/auth/audit?limit=${limit}`),

  // --- permissions (granular capability matrix, 2026-05-26) ---
  /** The signed-in user's own effective capabilities — drives the UI gates. */
  myCapabilities: () => request<string[]>('GET', '/auth/me/capabilities'),
  /** Full capability catalog + per-role defaults (admin-only). */
  listCapabilities: () => request<CapabilityRead[]>('GET', '/auth/capabilities'),
  /** A user's effective caps + overrides (admin-only). */
  getUserPermissions: (id: number) =>
    request<UserPermissionRead>('GET', `/auth/users/${id}/permissions`),
  /** Set/clear one per-user override (effect null = revert to role default). */
  setUserPermission: (id: number, capability: string, effect: PermissionEffect | null) =>
    request<UserPermissionRead>('PUT', `/auth/users/${id}/permissions`, {
      capability,
      effect,
    }),

  // --- permission requests (Task 10) ---
  /** Submit a capability request for the signed-in user.
   * The backend is idempotent — if a pending request already exists for this
   * capability it returns the existing row rather than 409. */
  requestPermission: (capability: string) =>
    request<unknown>('POST', '/permissions/requests', { capability }),
  /** List permission requests — admins see all, operators see their own. */
  listPermissionRequests: () =>
    request<PermissionRequestRead[]>('GET', '/permissions/requests'),
  /** Admin: approve or deny a request. */
  decidePermissionRequest: (
    id: number,
    body: { decision: string; window?: string; note?: string },
  ) => request<unknown>('POST', `/permissions/requests/${id}/decide`, body),

  // --- expiry (Phase B) ---
  getExpiry: (within = 90, type: 'all' | 'uae_id' | 'passport' = 'all') =>
    request<ExpiryItem[]>('GET', `/expiry${qs({ within, type })}`),
  getExpirySummary: () => request<ExpirySummary>('GET', '/expiry/summary'),

  // --- documents / jobs (Phase 04) ---
  generateDocument: (body: DocumentGenerateRequest) =>
    request<DocumentGenerateResponse>('POST', '/documents/generate', body),
  getJob: (jobId: string) => request<JobStatusResponse>('GET', `/jobs/${jobId}`),
  getDocument: (docId: number) => request<DocumentRead>('GET', `/documents/${docId}`),
  documentDownloadUrl: (docId: number, format: 'docx' | 'pdf') =>
    `${BASE}/documents/${docId}/download?format=${format}`,
  /** Park an attachment upload for a later generate call; the returned token
   * is echoed back inside `DocumentGenerateRequest.attachments`
   * (`source: 'staged'`). Forms signing paths & attachments, 2026-06-11. */
  stageAttachment: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return multipart<StagedAttachmentRead>('/documents/attachments/stage', form)
  },

  // --- notifications (Phase 4 LAN) ---
  /** JSON safety-poll fallback; used when EventSource is unavailable. */
  getNotificationCounts: () =>
    request<NotificationCounts>('GET', '/notifications/counts'),

  // --- Employee WhatsApp notifications ---
  sendWhatsApp: (eventType: WhatsAppEventType, recordId: number): Promise<WhatsAppSendResponse> =>
    request<WhatsAppSendResponse>('POST', '/whatsapp/send', { event_type: eventType, record_id: recordId }),
  getWhatsAppStatus: async (eventType: WhatsAppEventType, recordId: number): Promise<{ enabled: boolean; last: WhatsAppStatus | null }> => {
    const res = await request<{ enabled: boolean; last: WhatsAppStatus | null }>(
      'GET',
      `/whatsapp/status?event_type=${eventType}&record_id=${recordId}`,
    )
    return res
  },

  // --- web push (Phase 5 LAN) ---
  getVapidPublicKey: () => request<{ public_key: string }>('GET', '/push/vapid-public-key'),
  subscribePush: (sub: {
    endpoint: string
    keys: { p256dh: string; auth: string }
    locale?: string
  }) => request<void>('POST', '/push/subscribe', sub),
  unsubscribePush: (endpoint: string) =>
    request<void>('DELETE', '/push/subscribe', { endpoint }),
}

// --- Employee WhatsApp notifications --------------------------------------
export type WhatsAppEventType = 'leave_approved' | 'duty_resumption' | 'violation'

export interface WhatsAppSendResponse {
  status: 'sent' | 'failed'
  message_id: string | null
  error: string | null
}

export interface WhatsAppStatus {
  event_type: string
  event_ref: string
  language: string
  status: string
  error: string | null
  created_at: string
}

export function sendWhatsApp(
  eventType: WhatsAppEventType,
  recordId: number,
): Promise<WhatsAppSendResponse> {
  return request<WhatsAppSendResponse>('POST', '/whatsapp/send', { event_type: eventType, record_id: recordId })
}

export async function getWhatsAppStatus(
  eventType: WhatsAppEventType,
  recordId: number,
): Promise<{ enabled: boolean; last: WhatsAppStatus | null }> {
  const res = await request<{ enabled: boolean; last: WhatsAppStatus | null }>(
    'GET',
    `/whatsapp/status?event_type=${eventType}&record_id=${recordId}`,
  )
  return res
}

// --- Employee SMS notifications (on-site SIM gateway) ----------------------
export type SmsEventType =
  | 'leave_approved' | 'duty_resumption' | 'violation'
  | 'salary_transfer' | 'salary_deduction' | 'employee_clearance'
  | 'hr_request' | 'passport_release' | 'warning' | 'resignation'

export interface SmsSendResponse {
  status: 'sent' | 'failed'
  message_id: string | null
  error: string | null
}

export interface SmsStatus {
  event_type: string
  event_ref: string
  language: string
  status: string
  error: string | null
  created_at: string
}

export function sendSms(
  eventType: SmsEventType,
  recordId: number,
): Promise<SmsSendResponse> {
  return request<SmsSendResponse>('POST', '/sms/send', { event_type: eventType, record_id: recordId })
}

export async function getSmsStatus(
  eventType: SmsEventType,
  recordId: number,
): Promise<{ enabled: boolean; last: SmsStatus | null }> {
  return request<{ enabled: boolean; last: SmsStatus | null }>(
    'GET',
    `/sms/status?event_type=${eventType}&record_id=${recordId}`,
  )
}

export function refreshSmsDelivery(smsId: number): Promise<SmsMessageRead> {
  return request<SmsMessageRead>('POST', `/sms/${smsId}/refresh-delivery`)
}
