import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, ApiError, apiErrorMessage } from '@/lib/api'

export interface ReviewVerdict {
  approve: () => void
  pending: boolean
  mutate: (v: { decision: 'reviewed' | 'changes_requested'; note?: string }, onDone?: () => void) => void
}

/** Advisory reviewer verdict on one revision — shared by the phone dock and the focus bar. */
export function useReviewVerdict(bookId: number, versionId: number | undefined): ReviewVerdict {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const mut = useMutation({
    mutationFn: (v: { decision: 'reviewed' | 'changes_requested'; note?: string }) =>
      api.reviewBook(bookId, versionId ?? 0, v.decision, v.note),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      toast.success(t('books.reviewers.recorded'))
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'REVISION_CHANGED') {
        void qc.invalidateQueries({ queryKey: ['books', 'detail', bookId] })
        toast.error(t('books.approval.revisionChanged'))
        return
      }
      toast.error(apiErrorMessage(e))
    },
  })
  return {
    approve: () => mut.mutate({ decision: 'reviewed' }),
    pending: mut.isPending,
    mutate: (v, onDone) => mut.mutate(v, { onSuccess: onDone }),
  }
}
