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
  apiErrorMessage,
  type InmateCompletionIn,
  type InmateManualRowIn,
  type InmateManualRowPatch,
  type InmateRegisterClose,
  type InmateRegisterMonth,
} from '@/lib/api'

export const inmateRegisterKey = (year: number, month: number) =>
  ['inmate-register', year, month] as const
export const inmateNationalitiesKey = ['inmate-nationalities'] as const
export const inmateAwaitingCloseKey = ['inmate-register', 'awaiting-close'] as const

export interface UseInmateRegister {
  month: InmateRegisterMonth | undefined
  isLoading: boolean
  isError: boolean
  refetch: () => void
  createManualRow: (body: InmateManualRowIn) => void
  updateManualRow: (args: { rowId: number; body: InmateManualRowPatch }) => void
  deleteManualRow: (rowId: number) => void
  completeImport: (args: { bookId: number; body: InmateCompletionIn }) => void
  closeMonth: (body?: InmateRegisterClose) => void
  reopenMonth: () => void
  isWriting: boolean
}

/** The closed nationality list plus the alias table history resolves through. */
export function useInmateNationalities() {
  return useQuery({
    queryKey: inmateNationalitiesKey,
    queryFn: () => api.listInmateNationalities(),
    staleTime: Infinity,
  })
}

/** Admin-only standing state: ended months that still carry no seal. */
export function useInmateAwaitingClose(enabled = true) {
  return useQuery({
    queryKey: inmateAwaitingCloseKey,
    queryFn: () => api.getInmateRegisterAwaitingClose(),
    enabled,
    staleTime: 60_000,
  })
}

export function useInmateRegister(year: number, month: number): UseInmateRegister {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const key = inmateRegisterKey(year, month)

  const query = useQuery({
    queryKey: key,
    queryFn: () => api.getInmateRegisterMonth({ year, month }),
  })

  const settle = (fresh: InmateRegisterMonth, message: string): void => {
    qc.setQueryData(inmateRegisterKey(fresh.year, fresh.month), fresh)
    void qc.invalidateQueries({ queryKey: inmateAwaitingCloseKey })
    toast.success(message)
  }

  const failed = (error: unknown): void => {
    toast.error(apiErrorMessage(error))
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

  const close = useMutation({
    mutationFn: (body: InmateRegisterClose) =>
      api.closeInmateRegisterMonth({ year, month }, body),
    onSuccess: (fresh) => settle(fresh, t('inmateStats.toasts.closed')),
    onError: failed,
  })

  const reopen = useMutation({
    mutationFn: () => api.reopenInmateRegisterMonth({ year, month }),
    onSuccess: (fresh) => settle(fresh, t('inmateStats.toasts.reopened')),
    onError: failed,
  })

  return {
    month: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
    createManualRow: create.mutate,
    updateManualRow: update.mutate,
    deleteManualRow: remove.mutate,
    completeImport: complete.mutate,
    closeMonth: (body = {}) => close.mutate(body),
    reopenMonth: reopen.mutate,
    isWriting:
      create.isPending ||
      update.isPending ||
      remove.isPending ||
      complete.isPending ||
      close.isPending ||
      reopen.isPending,
  }
}
