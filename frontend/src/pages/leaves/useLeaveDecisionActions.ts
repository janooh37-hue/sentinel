/**
 * Shared leave decision mutations (update status / soft-delete) for the two
 * leave-detail surfaces — the desktop `RecordExpansion` and the mobile
 * `LeaveDetailDrawer` (TabRecords). Both previously hand-rolled these and had
 * drifted on cache invalidation (the drawer forgot `leave-balance`, the
 * expansion forgot `['leave', id]`); this hook invalidates the full set so both
 * stay consistent.
 */

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage } from '@/lib/api'
import type { LeaveStatus } from '@/lib/api'

interface Params {
  leaveId: number
  employeeId: string
  /** Called after a successful status update (and after delete unless `onDeleted`). */
  onMutated: () => void
  /** Called after a successful delete instead of `onMutated` (e.g. close the drawer). */
  onDeleted?: () => void
}

interface Decisions {
  updateMutation: UseMutationResult<unknown, Error, { status: LeaveStatus; n: string }>
  deleteMutation: UseMutationResult<unknown, Error, void>
}

export function useLeaveDecisionActions({
  leaveId,
  employeeId,
  onMutated,
  onDeleted,
}: Params): Decisions {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['leave', leaveId] })
    void qc.invalidateQueries({ queryKey: ['leaves-list'] })
    void qc.invalidateQueries({ queryKey: ['leave-balance', employeeId] })
  }

  const updateMutation = useMutation({
    mutationFn: ({ status, n }: { status: LeaveStatus; n: string }) =>
      api.updateLeave(leaveId, { status, notes: n || undefined }),
    onSuccess: (_data, { status }) => {
      invalidate()
      if (status === 'Approved') toast.success(t('leaves.toast.approved'))
      else if (status === 'Rejected') toast.success(t('leaves.toast.rejected'))
      else if (status === 'Cancelled') toast.success(t('leaves.toast.cancelled'))
      else toast.success(t('common.savedToast'))
      onMutated()
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteLeave(leaveId),
    onSuccess: () => {
      invalidate()
      toast.success(t('leaves.toast.deleted'))
      ;(onDeleted ?? onMutated)()
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  return { updateMutation, deleteMutation }
}
