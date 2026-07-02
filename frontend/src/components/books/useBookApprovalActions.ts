/**
 * Shared book approval mutations (decide = reject/return/note, sign = approve)
 * for the two book-decision surfaces — `BookRecordPage` and `BookDetailDrawer`,
 * which hand-rolled identical mutations (incl. the NO_SIGNATURE hint on sign)
 * and the same 3-key invalidation.
 *
 * The post-success behaviour differs on purpose and is left to the caller via
 * `onDecided` / `onSigned`: the drawer closes after either; the record page
 * navigates back to /books after a decision but deliberately STAYS after a sign
 * (so the signer watches their signature land on the document).
 */

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, ApiError, apiErrorMessage, type BookDecideAction } from '@/lib/api'

interface Params {
  bookId: number | undefined
  onDecided: (act: BookDecideAction) => void
  onSigned: () => void
}

interface Actions {
  decideMutation: UseMutationResult<unknown, Error, { act: BookDecideAction; note?: string }>
  signMutation: UseMutationResult<unknown, Error, void>
}

export function useBookApprovalActions({ bookId, onDecided, onSigned }: Params): Actions {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const invalidateAll = (): void => {
    void qc.invalidateQueries({ queryKey: ['books'] })
    void qc.invalidateQueries({ queryKey: ['books', 'awaiting'] })
    void qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const decideMutation = useMutation({
    mutationFn: ({ act, note }: { act: BookDecideAction; note?: string }) =>
      api.decideBook(bookId!, act, note),
    onSuccess: (_data, { act }) => {
      invalidateAll()
      const key =
        act === 'reject'
          ? 'books.approval.rejected'
          : act === 'return'
            ? 'books.approval.returned'
            : 'books.approval.noteAdded'
      toast.success(t(key))
      onDecided(act)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const signMutation = useMutation({
    mutationFn: () => api.signBook(bookId!),
    onSuccess: () => {
      invalidateAll()
      toast.success(t('books.approval.signed'))
      onSigned()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'NO_SIGNATURE') {
        toast.error(t('books.approval.noSignatureHint'))
      } else {
        toast.error(apiErrorMessage(err))
      }
    },
  })

  return { decideMutation, signMutation }
}
