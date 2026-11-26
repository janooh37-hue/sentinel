import { useEffect, useRef } from 'react'
import { type QueryClient, type QueryKey, useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import {
  api, ApiError, apiErrorMessage,
  type ArmoryBulkReturnCreate, type ArmoryCountFilters, type ArmoryCustodyCreate, type ArmoryCustodyFilters,
  type ArmoryDecisionCreate, type ArmoryDiscrepancyFilters, type ArmoryEmployeeFilters, type ArmoryFindFilters,
  type ArmoryGuardFilters, type ArmoryItemCreate, type ArmoryItemFilters, type ArmoryMonthlyCountCreate,
  type ArmoryMovementFilters, type ArmoryPeopleFilters, type ArmoryQualificationUpsert, type ArmoryReceiptCreate,
  type ArmoryReturnCreate, type ArmorySafeCreate, type ArmorySerialMovementCreate, type ArmorySerialRegistrationCreate,
  type ArmorySettingsUpdate, type ArmoryShiftCheckCreate, type ArmoryShiftIssueCreate, type ArmoryVoid,
} from '@/lib/api'
import { ARMORY_EDIT_CAP, ARMORY_QUERY_KEY, ARMORY_VIEW_CAP } from '@/lib/armory'
import { useAuth } from '@/lib/authContext'
import i18n from '@/lib/i18n'
import { useCapabilities } from '@/lib/useCapabilities'

/** Principal (user id) every Armory read is bound to; `null` before sign-in. */
type Principal = number | null

/** Every Armory key starts with `['armory', principal]`, so one prefix clears or refreshes them all. */
export const armoryKeys = {
  all: ARMORY_QUERY_KEY,
  principal: (principal: Principal) => [...ARMORY_QUERY_KEY, principal] as const,
  safes: (p: Principal) => [...ARMORY_QUERY_KEY, p, 'safes'] as const,
  siteOptions: (p: Principal) => [...ARMORY_QUERY_KEY, p, 'site-options'] as const,
  settings: (p: Principal) => [...ARMORY_QUERY_KEY, p, 'settings'] as const,
  kits: (p: Principal) => [...ARMORY_QUERY_KEY, p, 'kits'] as const,
  items: (p: Principal, filters: ArmoryItemFilters = {}) => [...ARMORY_QUERY_KEY, p, 'items', filters] as const,
  item: (p: Principal, itemId: number | null, safeId: number | null) => [...ARMORY_QUERY_KEY, p, 'item', itemId, safeId] as const,
  serial: (p: Principal, serialId: number | null) => [...ARMORY_QUERY_KEY, p, 'serial', serialId] as const,
  summary: (p: Principal, safeId: number | null) => [...ARMORY_QUERY_KEY, p, 'summary', safeId] as const,
  shift: (p: Principal, safeId: number | null) => [...ARMORY_QUERY_KEY, p, 'shift', safeId] as const,
  people: (p: Principal, filters: ArmoryPeopleFilters) => [...ARMORY_QUERY_KEY, p, 'people', filters] as const,
  issue: (p: Principal, issueId: number | null) => [...ARMORY_QUERY_KEY, p, 'issue', issueId] as const,
  custody: (p: Principal, filters: ArmoryCustodyFilters = {}) => [...ARMORY_QUERY_KEY, p, 'custody', filters] as const,
  custodyDetail: (p: Principal, custodyId: number | null) => [...ARMORY_QUERY_KEY, p, 'custody-detail', custodyId] as const,
  guards: (p: Principal, filters: ArmoryGuardFilters = {}) => [...ARMORY_QUERY_KEY, p, 'guards', filters] as const,
  guard: (p: Principal, employeeId: string | null) => [...ARMORY_QUERY_KEY, p, 'guard', employeeId] as const,
  shiftCheckDraft: (p: Principal, safeId: number | null) => [...ARMORY_QUERY_KEY, p, 'shift-check-draft', safeId] as const,
  monthlyCountDraft: (p: Principal, safeId: number | null) => [...ARMORY_QUERY_KEY, p, 'monthly-count-draft', safeId] as const,
  counts: (p: Principal, filters: ArmoryCountFilters = {}) => [...ARMORY_QUERY_KEY, p, 'counts', filters] as const,
  count: (p: Principal, countId: number | null) => [...ARMORY_QUERY_KEY, p, 'count', countId] as const,
  discrepancies: (p: Principal, filters: ArmoryDiscrepancyFilters = {}) => [...ARMORY_QUERY_KEY, p, 'discrepancies', filters] as const,
  movements: (p: Principal, filters: ArmoryMovementFilters = {}) => [...ARMORY_QUERY_KEY, p, 'movements', filters] as const,
  movement: (p: Principal, postingId: number | null) => [...ARMORY_QUERY_KEY, p, 'movement', postingId] as const,
  find: (p: Principal, filters: ArmoryFindFilters) => [...ARMORY_QUERY_KEY, p, 'find', filters] as const,
  employee: (p: Principal, employeeId: string | null, filters: ArmoryEmployeeFilters = {}) => [...ARMORY_QUERY_KEY, p, 'employee', employeeId, filters] as const,
  clearance: (p: Principal, employeeId: string | null) => [...ARMORY_QUERY_KEY, p, 'clearance', employeeId] as const,
}

/** Refreshes every live Armory read: Shift, Items, records, widget, employee file and clearance notice. */
export function invalidateArmoryQueries(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: ARMORY_QUERY_KEY })
}

/** A 401/403 answer means the cached payload must not stay on screen. */
export function isArmoryAccessError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403)
}

export interface ArmoryAccess {
  principal: Principal
  canView: boolean
  /** Writes require both capabilities. */
  canEdit: boolean
  /** Capabilities still loading: render nothing protected, start no request. */
  isLoading: boolean
}

export function useArmoryAccess(): ArmoryAccess {
  const { user } = useAuth()
  const { has, isLoading } = useCapabilities()
  const canView = has(ARMORY_VIEW_CAP)
  return { principal: user?.id ?? null, canView, canEdit: canView && has(ARMORY_EDIT_CAP), isLoading }
}

/**
 * Drops every cached Armory read when view is lost or the signed-in principal
 * changes. Mount once at the Armory route (and any surface that outlives it).
 * The route guard unmounts the page before a denied render, so the unmount
 * also checks the freshest capability list and clears when view is gone.
 */
export function useArmoryCacheLifecycle(): ArmoryAccess {
  const access = useArmoryAccess()
  const client = useQueryClient()
  const previous = useRef<{ principal: Principal; canView: boolean } | null>(null)
  useEffect(() => {
    const last = previous.current
    previous.current = { principal: access.principal, canView: access.canView }
    if (access.isLoading) return
    if (!access.canView || (last && last.principal !== access.principal)) clearArmoryCache(client)
  }, [access.canView, access.isLoading, access.principal, client])
  useEffect(() => () => {
    const capabilities = client.getQueryData<string[]>(['my-capabilities'])
    if (!capabilities?.includes(ARMORY_VIEW_CAP)) clearArmoryCache(client)
  }, [client])
  return access
}

function clearArmoryCache(client: QueryClient): void {
  void client.cancelQueries({ queryKey: ARMORY_QUERY_KEY })
  client.removeQueries({ queryKey: ARMORY_QUERY_KEY })
}

type Need = 'view' | 'edit'

/** Shared read wrapper: capability-gated, principal-bound, masked and evicted after 401/403. */
function useArmoryQuery<T>(need: Need, key: (principal: Principal) => QueryKey, queryFn: () => Promise<T>, enabled = true): UseQueryResult<T> {
  const access = useArmoryAccess()
  const client = useQueryClient()
  const allowed = (need === 'edit' ? access.canEdit : access.canView) && !access.isLoading && access.principal !== null
  const queryKey = key(access.principal)
  const query = useQuery({ queryKey, queryFn, enabled: allowed && enabled, retry: (count, error) => !isArmoryAccessError(error) && count < 2 })
  const denied = isArmoryAccessError(query.error)
  const serialKey = JSON.stringify(queryKey)
  useEffect(() => {
    if (denied) client.removeQueries({ queryKey: JSON.parse(serialKey) as QueryKey, exact: true })
  }, [client, denied, serialKey])
  if (!denied && allowed) return query
  return { ...query, data: undefined } as UseQueryResult<T>
}

// ── Reads shared with Records ────────────────────────────────────────────────

export function useArmorySafes() {
  return useArmoryQuery('view', p => armoryKeys.safes(p), () => api.listArmorySafes())
}
export function useArmoryKits() {
  return useArmoryQuery('view', p => armoryKeys.kits(p), () => api.listArmoryKits())
}
export function useArmoryItems(filters: ArmoryItemFilters = {}) {
  return useArmoryQuery('view', p => armoryKeys.items(p, filters), () => api.listArmoryItems(filters))
}
export function useArmoryItem(itemId: number | null, safeId: number | null) {
  return useArmoryQuery('view', p => armoryKeys.item(p, itemId, safeId), () => api.getArmoryItem(itemId as number, safeId ?? undefined), itemId !== null)
}
/**
 * Item details for several items in one safe, sharing `useArmoryItem`'s cache.
 * A form validates its batch lines against these reads; the per-line selector
 * owns the access-error eviction, so a denied read here only yields no data.
 */
export function useArmoryItemDetails(itemIds: readonly number[], safeId: number | null) {
  const access = useArmoryAccess()
  const allowed = access.canView && !access.isLoading && access.principal !== null && safeId !== null
  return useQueries({
    queries: itemIds.map(itemId => ({
      queryKey: armoryKeys.item(access.principal, itemId, safeId),
      queryFn: () => api.getArmoryItem(itemId, safeId ?? undefined),
      enabled: allowed,
      retry: (count: number, error: Error) => !isArmoryAccessError(error) && count < 2,
    })),
    combine: results => results.map(result => (allowed && !isArmoryAccessError(result.error) ? result.data : undefined)),
  })
}
export function useArmorySummary(safeId: number | null = null) {
  return useArmoryQuery('view', p => armoryKeys.summary(p, safeId), () => api.getArmorySummary(safeId ?? undefined))
}
/** Editor-only picker (`purpose` issue/custody/witness/qualification). */
export function useArmoryPeople(filters: ArmoryPeopleFilters, enabled = true) {
  return useArmoryQuery('edit', p => armoryKeys.people(p, filters), () => api.listArmoryPeople(filters), enabled)
}
export function useArmoryCustody(filters: ArmoryCustodyFilters = {}) {
  return useArmoryQuery('view', p => armoryKeys.custody(p, filters), () => api.listArmoryCustody(filters))
}
export function useArmoryCustodyDetail(custodyId: number | null) {
  return useArmoryQuery('view', p => armoryKeys.custodyDetail(p, custodyId), () => api.getArmoryCustody(custodyId as number), custodyId !== null)
}
export function useArmoryGuards(filters: ArmoryGuardFilters = {}) {
  return useArmoryQuery('view', p => armoryKeys.guards(p, filters), () => api.listArmoryGuards(filters))
}
/** Versioned: `data` is `{ data, etag }`; pass `etag` to `useSaveArmoryQualification`. */
export function useArmoryGuard(employeeId: string | null) {
  return useArmoryQuery('view', p => armoryKeys.guard(p, employeeId), () => api.getArmoryGuard(employeeId as string), employeeId !== null && employeeId !== '')
}
export function useArmoryCounts(filters: ArmoryCountFilters = {}) {
  return useArmoryQuery('view', p => armoryKeys.counts(p, filters), () => api.listArmoryCounts(filters))
}
export function useArmoryCount(countId: number | null) {
  return useArmoryQuery('view', p => armoryKeys.count(p, countId), () => api.getArmoryCount(countId as number), countId !== null)
}
export function useArmoryMonthlyCountDraft(safeId: number | null) {
  return useArmoryQuery('edit', p => armoryKeys.monthlyCountDraft(p, safeId), () => api.getArmoryMonthlyCountDraft(safeId as number), safeId !== null)
}
export function useArmoryDiscrepancies(filters: ArmoryDiscrepancyFilters = {}) {
  return useArmoryQuery('view', p => armoryKeys.discrepancies(p, filters), () => api.listArmoryDiscrepancies(filters))
}
export function useArmoryMovements(filters: ArmoryMovementFilters = {}) {
  return useArmoryQuery('view', p => armoryKeys.movements(p, filters), () => api.listArmoryMovements(filters))
}
export function useArmoryMovement(postingId: number | null) {
  return useArmoryQuery('view', p => armoryKeys.movement(p, postingId), () => api.getArmoryMovement(postingId as number), postingId !== null)
}
/** Employee file tab: needs `employees.view` too, checked by the caller's gate. */
export function useArmoryEmployee(employeeId: string | null, filters: ArmoryEmployeeFilters = {}) {
  const employees = useCapabilities().has('employees.view')
  return useArmoryQuery('view', p => armoryKeys.employee(p, employeeId, filters), () => api.getArmoryEmployee(employeeId as string, filters), employees && !!employeeId)
}
/** Clearance notice: the caller passes `enabled` only with the clearance form's own capabilities. */
export function useArmoryClearance(employeeId: string | null, enabled: boolean) {
  return useArmoryQuery('view', p => armoryKeys.clearance(p, employeeId), () => api.getArmoryClearance(employeeId as string), enabled && !!employeeId)
}

// ── Ops-only reads ───────────────────────────────────────────────────────────

export function useArmoryShift(safeId: number | null) {
  return useArmoryQuery('view', p => armoryKeys.shift(p, safeId), () => api.getArmoryShift(safeId ?? undefined))
}
export function useArmoryIssue(issueId: number | null) {
  return useArmoryQuery('view', p => armoryKeys.issue(p, issueId), () => api.getArmoryIssue(issueId as number), issueId !== null)
}
export function useArmorySerial(serialId: number | null) {
  return useArmoryQuery('view', p => armoryKeys.serial(p, serialId), () => api.getArmorySerial(serialId as number), serialId !== null)
}
/** Blank `q` returns recent serials in `recent_safe_id` scope; non-blank searches every safe. */
export function useArmoryFind(filters: ArmoryFindFilters, enabled = true) {
  return useArmoryQuery('view', p => armoryKeys.find(p, filters), () => api.findArmoryRecords(filters), enabled)
}
export function useArmoryShiftCheckDraft(safeId: number | null, enabled = true) {
  return useArmoryQuery('edit', p => armoryKeys.shiftCheckDraft(p, safeId), () => api.getArmoryShiftCheckDraft(safeId as number), enabled && safeId !== null)
}
/** Versioned: `data` is `{ data, etag }`. */
export function useArmorySettings(enabled = true) {
  return useArmoryQuery('edit', p => armoryKeys.settings(p), () => api.getArmorySettings(), enabled)
}
export function useArmorySiteOptions(enabled = true) {
  return useArmoryQuery('edit', p => armoryKeys.siteOptions(p), () => api.listArmorySiteOptions(), enabled)
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Typed Armory write: refreshes every live Armory read on success. A 403 also
 * refreshes the caller's capabilities, so revoked controls disappear.
 */
export function useArmoryMutation<TData, TVariables>(mutationFn: (variables: TVariables) => Promise<TData>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn,
    retry: false,
    onSuccess: () => invalidateArmoryQueries(client),
    onError: error => {
      if (isArmoryAccessError(error)) void client.invalidateQueries({ queryKey: ['my-capabilities'] })
      else if (error instanceof ApiError && armoryErrorRecovery(error) !== 'none') void invalidateArmoryQueries(client)
    },
  })
}

export function useCreateArmorySafe() {
  return useArmoryMutation((body: ArmorySafeCreate) => api.createArmorySafe(body))
}
export function useUpdateArmorySettings() {
  return useArmoryMutation(({ body, etag }: { body: ArmorySettingsUpdate; etag: string }) => api.updateArmorySettings(body, etag))
}
export function useCreateArmoryItem() {
  return useArmoryMutation((body: ArmoryItemCreate) => api.createArmoryItem(body))
}
export function useRecordArmorySerials() {
  return useArmoryMutation(({ itemId, body }: { itemId: number; body: ArmorySerialRegistrationCreate }) => api.recordArmorySerials(itemId, body))
}
export function useMoveArmorySerial() {
  return useArmoryMutation(({ serialId, body }: { serialId: number; body: ArmorySerialMovementCreate }) => api.moveArmorySerial(serialId, body))
}
export function useCreateArmoryReceipt() {
  return useArmoryMutation((body: ArmoryReceiptCreate) => api.createArmoryReceipt(body))
}
export function useCreateArmoryIssue() {
  return useArmoryMutation((body: ArmoryShiftIssueCreate) => api.createArmoryIssue(body))
}
export function useCreateArmoryCustody() {
  return useArmoryMutation((body: ArmoryCustodyCreate) => api.createArmoryCustody(body))
}
export function useCreateArmoryReturn() {
  return useArmoryMutation((body: ArmoryReturnCreate) => api.createArmoryReturn(body))
}
export function useCreateArmoryBulkReturn() {
  return useArmoryMutation((body: ArmoryBulkReturnCreate) => api.createArmoryBulkReturn(body))
}
export function useCreateArmoryShiftCheck() {
  return useArmoryMutation(({ safeId, body }: { safeId: number; body: ArmoryShiftCheckCreate }) => api.createArmoryShiftCheck(safeId, body))
}
export function useSaveArmoryQualification() {
  return useArmoryMutation(({ employeeId, body, etag }: { employeeId: string; body: ArmoryQualificationUpsert; etag: string }) => api.saveArmoryQualification(employeeId, body, etag))
}
export function useCreateArmoryMonthlyCount() {
  return useArmoryMutation(({ safeId, body }: { safeId: number; body: ArmoryMonthlyCountCreate }) => api.createArmoryMonthlyCount(safeId, body))
}
export function useDecideArmoryDiscrepancy() {
  return useArmoryMutation(({ discrepancyId, body }: { discrepancyId: number; body: ArmoryDecisionCreate }) => api.decideArmoryDiscrepancy(discrepancyId, body))
}
export function useVoidArmoryMovement() {
  return useArmoryMutation(({ postingId, body }: { postingId: number; body: ArmoryVoid }) => api.voidArmoryMovement(postingId, body))
}

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * How the UI recovers from an Armory error (SPEC §5): `refresh` reloads scoped
 * data, `revalidate` keeps the draft but re-renders current eligibility/state,
 * `redraft` needs a fresh draft or details, `reload` reloads a versioned record.
 * Never an automatic resubmit.
 */
export type ArmoryRecovery = 'refresh' | 'revalidate' | 'redraft' | 'reload' | 'none'

const RECOVERY: Readonly<Record<string, ArmoryRecovery>> = {
  armory_duplicate_serial: 'refresh', armory_batch_expiry_conflict: 'refresh', armory_insufficient_stock: 'refresh',
  armory_serial_unavailable: 'revalidate', armory_firearm_already_held: 'revalidate', armory_stale_return: 'revalidate',
  armory_course_required: 'revalidate', armory_licence_ack_required: 'revalidate', armory_off_duty_reason_required: 'revalidate',
  armory_self_issue: 'revalidate',
  armory_expired_batch: 'revalidate',
  armory_stale_check: 'redraft', armory_stale_count: 'redraft', armory_period_already_recorded: 'redraft',
  armory_stale_decision: 'redraft', armory_already_decided: 'redraft',
  armory_already_voided: 'refresh', armory_void_dependency: 'refresh', armory_write_conflict: 'refresh',
  armory_version_mismatch: 'reload',
}

export function armoryErrorRecovery(error: unknown): ArmoryRecovery {
  return error instanceof ApiError && Object.hasOwn(RECOVERY, error.code) ? RECOVERY[error.code] : 'none'
}

/** Translate Armory errors without exposing any server-provided message. */
export function armoryErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return apiErrorMessage(error)
  const { code, status } = error
  if (!code.startsWith('armory_')) return i18n.t('errors.generic')
  if (code === 'armory_not_found') {
    const resource = typeof error.details.resource === 'string' ? error.details.resource : ''
    const key = `assets.armory.errors.notFound.${resource}`
    return i18n.t(/^[a-z_]+$/.test(resource) && i18n.exists(key) ? key : 'assets.armory.errors.notFound.generic')
  }
  const camel = code.slice('armory_'.length).replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
  const key = `assets.armory.errors.${camel}`
  if (i18n.exists(key)) return i18n.t(key)
  if (status === 404) return i18n.t('assets.armory.errors.notFound.generic')
  if (status === 412) return i18n.t('assets.armory.errors.versionMismatch')
  if (status === 409) return i18n.t('assets.armory.errors.conflict')
  if (status === 422 || status === 400) return i18n.t('assets.armory.errors.invalidInput')
  return i18n.t('errors.generic')
}
