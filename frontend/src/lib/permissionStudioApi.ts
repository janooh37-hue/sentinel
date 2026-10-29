import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import { ApiError, request, requestVersioned } from '@/lib/api'
import type { components } from '@/lib/api.types'
import { useAuth } from '@/lib/authContext'

export type AccessSnapshot = components['schemas']['AccessSnapshot']
export type PreviewResponse = components['schemas']['PreviewResponse']
export type CheckResponse = components['schemas']['CheckResponse']
export type CheckRequest = components['schemas']['CheckRequest']
export type Patch = components['schemas']['Patch']
export type UserPermissionRead = components['schemas']['UserPermissionRead']

export const accessSnapshotKey = (operatorId: number | undefined, id: number) =>
  ['permission-studio', operatorId, id] as const
export const isAccessConflict = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 412

export function useAccessSnapshot(id: number): UseQueryResult<AccessSnapshot> {
  const { user, status } = useAuth()
  return useQuery({
    queryKey: [...accessSnapshotKey(user?.id, id), 'snapshot'],
    queryFn: () => request<AccessSnapshot>('GET', `/auth/users/${id}/effective-access`),
    enabled: status === 'authed' && id > 0,
    staleTime: 0,
  })
}

export function usePreviewAccess(id: number): UseMutationResult<PreviewResponse, Error, { expected_revision: string; items: Patch[] }> {
  return useMutation({
    mutationFn: (body) => request<PreviewResponse>('POST', `/auth/users/${id}/effective-access/preview`, body),
  })
}

export function useCheckAccess(id: number): UseMutationResult<CheckResponse, Error, CheckRequest> {
  return useMutation({
    mutationFn: (body) => request<CheckResponse>('POST', `/auth/users/${id}/check-access`, body),
  })
}

export function useSaveAccess(id: number): UseMutationResult<UserPermissionRead, Error, { revision: string; items: Patch[] }> {
  const client = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationKey: [...accessSnapshotKey(user?.id, id), 'save'],
    mutationFn: async ({ revision, items }) => {
      if (!revision.trim()) throw new ApiError(400, 'MISSING_REVISION', 'A current access revision is required')
      const response = await requestVersioned<UserPermissionRead>('PUT', `/auth/users/${id}/permissions/bulk`, { items }, revision)
      return response.data
    },
    onSuccess: () => {
      // A server-confirmed save must not wait for unrelated consumer refetches.
      // The workspace separately awaits its authoritative post-save snapshot.
      void Promise.all([
        // The workspace performs the authoritative post-save read. Mark this
        // cache stale without issuing a competing read before that refresh.
        client.invalidateQueries({ queryKey: accessSnapshotKey(user?.id, id), refetchType: 'none' }),
        client.invalidateQueries({ queryKey: ['user-permissions', id] }),
        client.invalidateQueries({ queryKey: ['departments'] }),
        client.invalidateQueries({ queryKey: ['my-capabilities'] }),
      ])
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 403) {
        await client.invalidateQueries({ queryKey: ['my-capabilities'] })
      }
    },
  })
}
