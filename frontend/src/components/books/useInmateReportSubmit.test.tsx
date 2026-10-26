import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type * as ApiModule from '@/lib/api'
import { api, ApiError } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { TemplateDetailResponse } from '@/components/application/types'
import { notifyInmateReportSubmitError, useInmateReportSubmit } from './useInmateReportSubmit'

vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof ApiModule>()
  return { ...real, api: { ...real.api, submitBook: vi.fn(), getTemplateFields: vi.fn() } }
})
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ar' } }) }))

const schema = {
  meta: {}, needs_manager: false, needs_submitter: false,
  fields: [
    { id: 'report_date', type: 'date', label_en: 'Report date', label_ar: 'تاريخ التقرير' },
    { id: 'inmates', type: 'inmates_table', label_en: 'Inmates', label_ar: 'النزلاء' },
  ],
} as TemplateDetailResponse
const error = new ApiError(422, 'INMATE_REPORT_INCOMPLETE', 'Incomplete', {
  fields: ['report_date', 'inmates[1].name', 123],
})

beforeEach(() => vi.clearAllMocks())

it.each([
  ['en', 'Report date, Inmates · Name · 2'],
  ['ar', 'تاريخ التقرير، النزلاء · الاسم · 2'],
])('shows localized missing labels with the %s list separator and a usable revise action', (language, description) => {
  const revise = vi.fn()
  const t = (key: string) => key === 'application.inmatesTable.name' ? (language === 'ar' ? 'الاسم' : 'Name') : key
  notifyInmateReportSubmitError(error, t, language, schema, revise)
  const options = vi.mocked(toast.error).mock.calls[0][1]
  expect(options?.description).toBe(description)
  expect(options?.duration).toBe(8000)
  options?.action?.onClick()
  expect(revise).toHaveBeenCalledOnce()
})

it('loads template labels once and routes the failed book id through the shared action', async () => {
  vi.mocked(api.submitBook).mockRejectedValue(error)
  vi.mocked(api.getTemplateFields).mockResolvedValue({
    ...schema, signing_path: 'chain', attachment_slots: [],
    fields: schema.fields.map((field) => ({ id: field.id, type: field.type, label_en: field.label_en, label_ar: field.label_ar, required: false })),
  })
  const revise = vi.fn()
  const onError = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useInmateReportSubmit({ onRevise: revise, onError }), { wrapper })
  act(() => result.current.mutate(42))
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce())
  expect(onError).toHaveBeenCalledWith(error, 'application.inmateReporter.incomplete', 42)
  expect(vi.mocked(toast.error).mock.calls[0][1]?.description).toContain('تاريخ التقرير')
  act(() => vi.mocked(toast.error).mock.calls[0][1]?.action?.onClick())
  expect(revise).toHaveBeenCalledWith(42)
  act(() => result.current.mutate(42))
  await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2))
  expect(api.getTemplateFields).toHaveBeenCalledOnce()
})
