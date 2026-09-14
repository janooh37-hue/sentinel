/**
 * Server state for the monthly inmate violation register.
 *
 * One month query serves both states — live projection while `closed` is false,
 * frozen entries once it is true — so no consumer branches on which endpoint to
 * call. Every write answers with the refreshed month, which is written straight
 * into the cache instead of triggering a second fetch.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  api,
  ApiError,
  apiErrorMessage,
  type InmateCompletionIn,
  type InmateManualRowIn,
  type InmateManualRowPatch,
  type InmateRegisterApprove,
  type InmateRegisterMonth,
  type InmateRegisterPrepare,
  type InmateRegisterReopen,
  type InmateRegisterReturn,
  type InmateRegisterReview,
  type InmateWorkflowCandidate,
} from '@/lib/api'

export const inmateRegisterKey = (year: number, month: number) =>
  ['inmate-register', year, month] as const
export const inmateNationalitiesKey = ['inmate-nationalities'] as const
export const inmateAwaitingCloseKey = ['inmate-register', 'awaiting-close'] as const

interface MutationCallbacks {
  onSuccess?: () => void
}

export interface UseInmateRegister {
  month: InmateRegisterMonth | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
  refetch: () => void
  reviewers: InmateWorkflowCandidate[]
  managers: InmateWorkflowCandidate[]
  candidatesLoading: boolean
  candidatesError: unknown
  retryCandidates: () => void
  createManualRow: (body: InmateManualRowIn, options?: MutationCallbacks) => void
  updateManualRow: (
    args: { rowId: number; body: InmateManualRowPatch },
    options?: MutationCallbacks
  ) => void
  deleteManualRow: (rowId: number, options?: MutationCallbacks) => void
  completeImport: (args: { bookId: number; body: InmateCompletionIn }) => void
  prepareMonth: (body: InmateRegisterPrepare) => void
  reviewMonth: (body: InmateRegisterReview) => void
  returnMonth: (body: InmateRegisterReturn) => void
  approveMonth: (body: InmateRegisterApprove) => void
  reopenMonth: (body: InmateRegisterReopen) => void
  isWriting: boolean
  mutationError: string | null
}

/** The closed nationality list and its known alternate labels. */
export function useInmateNationalities() {
  return useQuery({
    queryKey: inmateNationalitiesKey,
    queryFn: () => api.listInmateNationalities(),
    staleTime: Infinity,
  })
}

/** Ended months the current caller can act on. */
export function useInmateAwaitingClose() {
  return useQuery({
    queryKey: inmateAwaitingCloseKey,
    queryFn: () => api.getInmateRegisterAwaitingClose(),
    staleTime: 60_000,
  })
}

export function useInmateRegister(year: number, month: number): UseInmateRegister {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const key = inmateRegisterKey(year, month)

  const query = useQuery({
    queryKey: key,
    queryFn: () => api.getInmateRegisterMonth({ year, month }),
  })

  const reviewers = useQuery({
    queryKey: [...key, 'candidates', 'review', query.data?.workflow.version],
    queryFn: () => api.getInmateRegisterCandidates({ year, month }, 'review'),
    enabled: query.data?.workflow.allowed_actions.includes('prepare') ?? false,
  })

  const managers = useQuery({
    queryKey: [...key, 'candidates', 'approve', query.data?.workflow.version],
    queryFn: () => api.getInmateRegisterCandidates({ year, month }, 'approve'),
    enabled: query.data?.workflow.allowed_actions.includes('review') ?? false,
  })

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: inmateAwaitingCloseKey })
    void qc.invalidateQueries({ queryKey: ['notifications', 'counts'] })
  }

  const settle = (fresh: InmateRegisterMonth, message: string): void => {
    qc.setQueryData(inmateRegisterKey(fresh.year, fresh.month), fresh)
    invalidate()
    toast.success(message)
  }

  const errorMessage = (error: unknown): string => {
    const key = error instanceof ApiError ? `inmateStats.workflow.errors.${error.code}` : ''
    return key && i18n.exists(key) ? t(key) : apiErrorMessage(error)
  }

  const failed = (error: unknown): void => {
    toast.error(errorMessage(error))
  }

  const create = useMutation({
    mutationFn: (body: InmateManualRowIn) => api.createInmateManualRow({ year, month }, body),
    onSuccess: (fresh) => settle(fresh, t('inmateStats.toasts.created')),
    onError: failed,
  })

  const update = useMutation({
    mutationFn: (args: { rowId: number; body: InmateManualRowPatch }) =>
      api.updateInmateManualRow(args.rowId, args.body),
    onSuccess: (fresh) => settle(fresh, t('inmateStats.toasts.updated')),
    onError: failed,
  })

  const remove = useMutation({
    mutationFn: (rowId: number) => api.deleteInmateManualRow(rowId),
    onSuccess: (fresh) => settle(fresh, t('inmateStats.toasts.deleted')),
    onError: failed,
  })

  const complete = useMutation({
    mutationFn: (args: { bookId: number; body: InmateCompletionIn }) =>
      api.completeInmateImport(args.bookId, args.body),
    onSuccess: (fresh) => {
      settle(fresh, t('inmateStats.toasts.completed'))
      // The completion wrote into the Record's stored payload.
      void qc.invalidateQueries({ queryKey: ['books'] })
    },
    onError: failed,
  })

  const prepare = useMutation({
    mutationFn: (body: InmateRegisterPrepare) =>
      api.prepareInmateRegisterMonth({ year, month }, body),
    onSuccess: (fresh) => settle(fresh, t('inmateStats.workflow.preparedToast')),
    onError: failed,
  })

  const review = useMutation({
    mutationFn: (body: InmateRegisterReview) =>
      api.reviewInmateRegisterMonth({ year, month }, body),
    onSuccess: (fresh) => settle(fresh, t('inmateStats.workflow.reviewedToast')),
    onError: failed,
  })

  const returnReport = useMutation({
    mutationFn: (body: InmateRegisterReturn) =>
      api.returnInmateRegisterMonth({ year, month }, body),
    onSuccess: (fresh) => settle(fresh, t('inmateStats.workflow.returnedToast')),
    onError: failed,
  })

  const approve = useMutation({
    mutationFn: (body: InmateRegisterApprove) =>
      api.approveInmateRegisterMonth({ year, month }, body),
    onSuccess: (fresh) => settle(fresh, t('inmateStats.toasts.closed')),
    onError: failed,
  })

  const reopen = useMutation({
    mutationFn: (body: InmateRegisterReopen) =>
      api.reopenInmateRegisterMonth({ year, month }, body),
    onSuccess: (fresh) => settle(fresh, t('inmateStats.toasts.reopened')),
    onError: failed,
  })

  const writes = [create, update, remove, complete, prepare, review, returnReport, approve, reopen]
  const latestError = writes
    .filter((write) => write.error)
    .sort((left, right) => right.submittedAt - left.submittedAt)[0]?.error

  return {
    month: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
    reviewers: reviewers.data ?? [],
    managers: managers.data ?? [],
    candidatesLoading: reviewers.isFetching || managers.isFetching,
    candidatesError: reviewers.error ?? managers.error,
    retryCandidates: () => {
      if (query.data?.workflow.allowed_actions.includes('prepare')) void reviewers.refetch()
      if (query.data?.workflow.allowed_actions.includes('review')) void managers.refetch()
    },
    createManualRow: create.mutate,
    updateManualRow: update.mutate,
    deleteManualRow: remove.mutate,
    completeImport: complete.mutate,
    prepareMonth: prepare.mutate,
    reviewMonth: review.mutate,
    returnMonth: returnReport.mutate,
    approveMonth: approve.mutate,
    reopenMonth: reopen.mutate,
    isWriting: writes.some((write) => write.isPending),
    mutationError: latestError ? errorMessage(latestError) : null,
  }
}
