import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api, ApiError, apiErrorMessage } from '@/lib/api'

export function inmateReportSubmitErrorMessage(error: unknown, t: (key: string) => string): string {
  if (!(error instanceof ApiError)) return apiErrorMessage(error)
  switch (error.code) {
    case 'INMATE_REPORT_INCOMPLETE':
      return t('application.inmateReporter.incomplete')
    case 'INMATE_REPORTER_MANAGER_UNAVAILABLE':
      return t('application.inmateReporter.managerUnavailable')
    case 'INMATE_REPORTER_STATE_LOCKED':
    case 'INMATE_REPORTER_NOT_OWNER':
    case 'INMATE_REPORTER_IDENTITY_CHANGED':
      return t('application.inmateReporter.stale')
    default:
      return apiErrorMessage(error)
  }
}

interface Options {
  onSuccess?: () => void
  onError?: (error: unknown, message: string, bookId: number) => void
}

/** The fixed-scope reporter submit: always routed to the configured manager. */
export function useInmateReportSubmit(options: Options = {}) {
  const qc = useQueryClient()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: (bookId: number) => api.submitBook(bookId, {
      priority: 'Normal',
      approver_user_id: null,
      reviewer_user_ids: [],
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      options.onSuccess?.()
    },
    onError: (error, bookId) =>
      options.onError?.(error, inmateReportSubmitErrorMessage(error, t), bookId),
  })
}
