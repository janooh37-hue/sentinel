import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  api, ApiError, apiErrorMessage,
  type UniformItemCreate, type UniformItemUpdate, type UniformSizeCreate,
  type UniformSizeUpdate, type UniformReceiptCreate, type UniformIssueCreate,
  type UniformReturnCreate, type UniformAdjustmentCreate, type UniformVoid,
} from '@/lib/api'
import i18n from '@/lib/i18n'

export const uniformKeys = {
  all: ['uniform'] as const,
  items: (includeArchived = false) => ['uniform', 'items', { includeArchived }] as const,
  receipts: ['uniform', 'receipts'] as const,
  issues: (employeeId?: string) => ['uniform', 'issues', employeeId ?? null] as const,
  returns: (employeeId?: string) => ['uniform', 'returns', employeeId ?? null] as const,
  adjustments: ['uniform', 'adjustments'] as const,
  recipients: (q = '') => ['uniform', 'recipients', q] as const,
  employee: (employeeId: string) => ['uniform', 'employees', employeeId] as const,
  summary: ['uniform', 'summary'] as const,
}

/** Employee-file holdings share this prefix, so every write refreshes every surface. */
export function invalidateUniformQueries(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: uniformKeys.all })
}

export function useUniformItems(includeArchived = false) {
  return useQuery({ queryKey: uniformKeys.items(includeArchived), queryFn: () => api.listUniformItems(includeArchived) })
}
export function useUniformReceipts() {
  return useQuery({ queryKey: uniformKeys.receipts, queryFn: api.listUniformReceipts })
}
export function useUniformIssues(employeeId?: string) {
  return useQuery({ queryKey: uniformKeys.issues(employeeId), queryFn: () => api.listUniformIssues(employeeId) })
}
export function useUniformReturns(employeeId?: string) {
  return useQuery({ queryKey: uniformKeys.returns(employeeId), queryFn: () => api.listUniformReturns(employeeId) })
}
export function useUniformAdjustments() {
  return useQuery({ queryKey: uniformKeys.adjustments, queryFn: api.listUniformAdjustments })
}
export function useUniformRecipients(q = '') {
  return useQuery({ queryKey: uniformKeys.recipients(q), queryFn: () => api.listUniformRecipients(q) })
}
export function useUniformEmployee(employeeId: string) {
  return useQuery({ queryKey: uniformKeys.employee(employeeId), queryFn: () => api.getUniformEmployee(employeeId), enabled: employeeId.length > 0 })
}
export function useUniformSummary() {
  return useQuery({ queryKey: uniformKeys.summary, queryFn: api.getUniformSummary })
}

function useUniformMutation<TData, TVariables>(mutationFn: (variables: TVariables) => Promise<TData>) {
  const client = useQueryClient()
  return useMutation({ mutationFn, onSuccess: () => invalidateUniformQueries(client) })
}

export function useCreateUniformItem() {
  return useUniformMutation((body: UniformItemCreate) => api.createUniformItem(body))
}
export function useUpdateUniformItem() {
  return useUniformMutation(({ id, body, ifMatch }: { id: number; body: UniformItemUpdate; ifMatch: string }) => api.updateUniformItem(id, body, ifMatch))
}
export function useArchiveUniformItem() {
  return useUniformMutation(api.archiveUniformItem)
}
export function useDeleteUniformItem() {
  return useUniformMutation(api.deleteUniformItem)
}
export function useAddUniformSize() {
  return useUniformMutation(({ itemId, body }: { itemId: number; body: UniformSizeCreate }) => api.addUniformSize(itemId, body))
}
export function useUpdateUniformSize() {
  return useUniformMutation(({ id, body }: { id: number; body: UniformSizeUpdate }) => api.updateUniformSize(id, body))
}
export function useRemoveUniformSize() {
  return useUniformMutation(api.removeUniformSize)
}
export function useCreateUniformReceipt() {
  return useUniformMutation((body: UniformReceiptCreate) => api.createUniformReceipt(body))
}
export function useCreateUniformIssue() {
  return useUniformMutation((body: UniformIssueCreate) => api.createUniformIssue(body))
}
export function useCreateUniformReturn() {
  return useUniformMutation((body: UniformReturnCreate) => api.createUniformReturn(body))
}
export function useCreateUniformAdjustments() {
  return useUniformMutation((body: UniformAdjustmentCreate) => api.createUniformAdjustments(body))
}

type VoidVariables = { id: number; body: UniformVoid }
export function useVoidUniformReceipt() {
  return useUniformMutation(({ id, body }: VoidVariables) => api.voidUniformReceipt(id, body))
}
export function useVoidUniformIssue() {
  return useUniformMutation(({ id, body }: VoidVariables) => api.voidUniformIssue(id, body))
}
export function useVoidUniformReturn() {
  return useUniformMutation(({ id, body }: VoidVariables) => api.voidUniformReturn(id, body))
}
export function useVoidUniformAdjustment() {
  return useUniformMutation(({ id, body }: VoidVariables) => api.voidUniformAdjustment(id, body))
}

/** Only Uniform errors receive module copy; unrelated permission/network errors retain shared handling. */
export function uniformErrorMessage(error: unknown): string {
  return apiErrorMessage(error, code => {
    if (!(error instanceof ApiError) || !code.startsWith('uniform_')) return null
    const camel = code.slice('uniform_'.length).replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    const key = `assets.uniform.errors.${camel}`
    if (i18n.exists(key)) return key
    if (error.status === 412) return 'assets.uniform.errors.versionConflict'
    if (error.status === 409) return 'assets.uniform.errors.conflict'
    return null
  })
}
