import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  api, ApiError, apiErrorMessage, type InmateCompletionIn, type InmateManualRowIn,
  type InmateManualRowPatch, type InmateRegisterMonth, type InmateRegisterPrepare,
  type InmateRegisterReview, type InmateRegisterApprove, type InmateRegisterReturn,
  type InmateRegisterReopen,
} from '@/lib/api'

export const inmateRegisterKey = (year: number, month: number) => ['inmate-register', year, month] as const
export const inmateNationalitiesKey = ['inmate-nationalities'] as const
export const inmateTasksKey = ['inmate-register', 'tasks'] as const

export function useInmateNationalities() {
  return useQuery({ queryKey: inmateNationalitiesKey, queryFn: api.listInmateNationalities, staleTime: Infinity })
}

/** Eligibility and route reachability come from the server's shared task enumeration. */
export function useInmateTasks(enabled = true) {
  return useQuery({ queryKey: inmateTasksKey, queryFn: api.getInmateRegisterTasks,
    enabled, staleTime: 30_000, refetchInterval: 120_000 })
}

/** Current register and selected immutable report deliberately use separate cache entries. */
export function useInmateRegister(year: number, month: number, submissionId: number | null = null) {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const key = inmateRegisterKey(year, month)
  const coordinate = { year, month }
  const query = useQuery({ queryKey: key, queryFn: () => api.getInmateRegisterMonth(coordinate) })
  const history = useQuery({ queryKey: [...key, 'history'], queryFn: () => api.getInmateRegisterSubmissions(coordinate) })
  const report = useQuery({ queryKey: [...key, 'submission', submissionId],
    queryFn: () => api.getInmateRegisterSubmission(coordinate, submissionId!),
    enabled: submissionId !== null, retry: false })
  const reviewers = useQuery({ queryKey: [...key, 'candidates', 'review', query.data?.workflow.version],
    queryFn: () => api.getInmateRegisterCandidates(coordinate, 'review'),
    enabled: query.data?.workflow.allowed_actions.includes('prepare') ?? false })
  const managers = useQuery({ queryKey: [...key, 'candidates', 'approve', query.data?.workflow.version],
    queryFn: () => api.getInmateRegisterCandidates(coordinate, 'approve'),
    enabled: query.data?.workflow.allowed_actions.includes('review') ?? false })

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: key })
    void qc.invalidateQueries({ queryKey: inmateTasksKey })
    void qc.invalidateQueries({ queryKey: ['notifications', 'counts'] })
  }
  const settle = (fresh: InmateRegisterMonth, message: string): void => {
    qc.setQueryData(inmateRegisterKey(fresh.year, fresh.month), fresh)
    invalidate()
    toast.success(message)
  }
  const message = (error: unknown): string => {
    const translation = error instanceof ApiError ? `inmateStats.workflow.errors.${error.code}` : ''
    return translation && i18n.exists(translation) ? t(translation) : apiErrorMessage(error)
  }
  const failed = (error: unknown): void => { invalidate(); toast.error(message(error)) }
  const create = useMutation({ mutationFn: (body: InmateManualRowIn) => api.createInmateManualRow(coordinate, body),
    onSuccess: (fresh) => settle(fresh, t('inmateStats.toasts.created')), onError: failed })
  const update = useMutation({ mutationFn: (args: { rowId: number; body: InmateManualRowPatch }) => api.updateInmateManualRow(args.rowId, args.body),
    onSuccess: (fresh) => settle(fresh, t('inmateStats.toasts.updated')), onError: failed })
  const remove = useMutation({ mutationFn: api.deleteInmateManualRow,
    onSuccess: (fresh) => settle(fresh, t('inmateStats.toasts.deleted')), onError: failed })
  const complete = useMutation({ mutationFn: (args: { bookId: number; body: InmateCompletionIn }) => api.completeInmateImport(args.bookId, args.body),
    onSuccess: (fresh) => { settle(fresh, t('inmateStats.toasts.completed')); void qc.invalidateQueries({ queryKey: ['books'] }) }, onError: failed })
  const prepare = useMutation({ mutationFn: (body: InmateRegisterPrepare) => api.prepareInmateRegisterMonth(coordinate, body),
    onSuccess: (fresh) => settle(fresh, t('inmateStats.workflow.preparedToast')), onError: failed })
  const review = useMutation({ mutationFn: (body: InmateRegisterReview) => api.reviewInmateRegisterMonth(coordinate, body),
    onSuccess: (fresh) => settle(fresh, t('inmateStats.workflow.reviewedToast')), onError: failed })
  const approve = useMutation({ mutationFn: (body: InmateRegisterApprove) => api.approveInmateRegisterMonth(coordinate, body),
    onSuccess: (fresh) => settle(fresh, t('inmateStats.toasts.closed')), onError: failed })
  const returnReport = useMutation({ mutationFn: (body: InmateRegisterReturn) => api.returnInmateRegisterMonth(coordinate, body),
    onSuccess: (fresh) => settle(fresh, t('inmateStats.workflow.returnedToast')), onError: failed })
  const reopen = useMutation({ mutationFn: (body: InmateRegisterReopen) => api.reopenInmateRegisterMonth(coordinate, body),
    onSuccess: (fresh) => settle(fresh, t('inmateStats.toasts.reopened')), onError: failed })
  const writes = [create, update, remove, complete, prepare, review, approve, returnReport, reopen]
  const latestError = [...writes].sort((a, b) => b.submittedAt - a.submittedAt)[0]?.error

  return {
    month: query.data, isLoading: query.isLoading, isError: query.isError, error: query.error,
    refetch: () => {
      void query.refetch(); void history.refetch()
      if (query.data?.workflow.allowed_actions.includes('prepare')) void reviewers.refetch()
      if (query.data?.workflow.allowed_actions.includes('review')) void managers.refetch()
    },
    history: history.data ?? [], historyLoading: history.isLoading, historyError: history.error,
    selectedReport: report.data, reportLoading: report.isFetching, reportError: report.error,
    refreshReport: () => { void query.refetch(); if (submissionId !== null) void report.refetch() },
    reviewers: reviewers.data ?? [], managers: managers.data ?? [],
    candidatesLoading: reviewers.isLoading || managers.isLoading,
    candidatesError: reviewers.error ?? managers.error,
    createManualRow: create.mutate, updateManualRow: update.mutate, deleteManualRow: remove.mutate,
    completeImport: complete.mutate, prepareMonth: prepare.mutate, reviewMonth: review.mutate,
    approveMonth: approve.mutate, returnMonth: returnReport.mutate, reopenMonth: reopen.mutate,
    isWriting: writes.some((write) => write.isPending), mutationError: latestError ? message(latestError) : null,
  }
}

export type UseInmateRegister = ReturnType<typeof useInmateRegister>
