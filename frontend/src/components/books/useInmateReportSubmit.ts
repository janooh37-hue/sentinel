import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api, ApiError, apiErrorMessage } from '@/lib/api'
import { toast } from '@/lib/toast'

type ReportFieldSchema = {
  fields: { id: string; label_en: string; label_ar: string }[]
}

const INMATE_FIELD_LOCALE_KEY: Record<string, string> = {
  name: 'application.inmatesTable.name',
  nationality: 'application.inmatesTable.nationality',
  wing: 'application.inmatesTable.wing',
  uid: 'application.inmatesTable.uid',
  holding_no: 'application.inmatesTable.holdingNo',
}

export function inmateReportFieldLabel(
  path: string,
  schema: ReportFieldSchema | null | undefined,
  t: (key: string) => string,
  language: string,
): string {
  const fieldId = path.match(/^[^.[\]]+/)?.[0] ?? path
  const field = schema?.fields.find((candidate) => candidate.id === fieldId)
  const base = field ? (language.startsWith('ar') ? field.label_ar || field.label_en : field.label_en) : path
  const inmateCell = path.match(/^inmates\[(\d+)\]\.(name|nationality|wing|uid|holding_no)$/)
  if (!inmateCell) return base
  return `${base} · ${t(INMATE_FIELD_LOCALE_KEY[inmateCell[2]])} · ${Number(inmateCell[1]) + 1}`
}

export function notifyInmateReportSubmitError(
  error: unknown,
  t: (key: string) => string,
  language: string,
  schema?: ReportFieldSchema | null,
  onRevise?: () => void,
): void {
  const message = inmateReportSubmitErrorMessage(error, t)
  if (error instanceof ApiError && error.code === 'INMATE_REPORT_INCOMPLETE') {
    const fields = Array.isArray(error.details.fields)
      ? error.details.fields.filter((field): field is string => typeof field === 'string')
      : []
    toast.error(message, {
      description: fields.map((field) => inmateReportFieldLabel(field, schema, t, language))
        .join(language.startsWith('ar') ? '، ' : ', '),
      duration: 8000,
      action: onRevise ? { label: t('books.pane.continueDraft'), onClick: onRevise } : undefined,
    })
  } else {
    toast.error(message)
  }
}

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
  onRevise?: (bookId: number) => void
}

/** The fixed-scope reporter submit: always routed to the configured manager. */
export function useInmateReportSubmit(options: Options = {}) {
  const qc = useQueryClient()
  const { t, i18n } = useTranslation()
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
    onError: async (error, bookId) => {
      options.onError?.(error, inmateReportSubmitErrorMessage(error, t), bookId)
      let schema: ReportFieldSchema | undefined
      if (error instanceof ApiError && error.code === 'INMATE_REPORT_INCOMPLETE') {
        try {
          schema = await qc.fetchQuery({
            queryKey: ['template-fields', 'Inmate Conduct Violations'],
            queryFn: () => api.getTemplateFields('Inmate Conduct Violations'),
            staleTime: Infinity,
          })
        } catch {
          // Keep the original submission error visible even if labels cannot load.
        }
      }
      notifyInmateReportSubmitError(error, t, i18n.language, schema,
        options.onRevise ? () => options.onRevise?.(bookId) : undefined)
    },
  })
}
