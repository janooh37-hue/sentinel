import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api, ApiError, apiErrorMessage } from '@/lib/api'
import { toast } from '@/lib/toast'

/** The source-change error lists the fines that can no longer be rebuilt. */
export function vehicleLetterRebuildErrorMessage(
  error: unknown,
  t: (key: string, options?: { fines: string }) => string,
  language: string,
): string {
  if (!(error instanceof ApiError) || error.code !== 'LETTER_SOURCE_CHANGED') return apiErrorMessage(error)
  const ids = Array.isArray(error.details.fine_ids)
    ? error.details.fine_ids.filter((id): id is string | number => typeof id === 'number' || typeof id === 'string')
    : []
  if (ids.length === 0) return apiErrorMessage(error)
  const fines = ids.map((id) => `#${id}`).join(language.startsWith('ar') ? '، ' : ', ')
  return t('errors.fleet.letterSourceChangedFines', { fines })
}

export function useVehicleLetterRebuild() {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ bookId, versionId }: { bookId: number; versionId: number }) =>
      api.rebuildVehicleLetter(bookId, versionId),
    onSuccess: (book) => {
      // Live detail entries only: never replace a pinned historical revision.
      qc.setQueryData(['books', 'detail', book.id], book)
      qc.setQueryData(['books', 'detail', book.id, null], book)
      void qc.invalidateQueries({ queryKey: ['books'] })
      toast.success(t('books.fleetReporter.rebuilt'), { reference: book.ref_number })
    },
    onError: (error, { bookId }) => {
      if (error instanceof ApiError && error.code === 'REVISION_CHANGED') {
        void qc.invalidateQueries({ queryKey: ['books', 'detail', bookId] })
      }
      toast.error(vehicleLetterRebuildErrorMessage(error, t, i18n.language))
    },
  })
}
