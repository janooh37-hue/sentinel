import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { api, ApiError, apiErrorMessage } from '@/lib/api'
import type { BookRead } from '@/lib/api'
import type * as ApiModule from '@/lib/api'
import i18n from '@/lib/i18n'
import { toast } from '@/lib/toast'
import { useVehicleLetterRebuild, vehicleLetterRebuildErrorMessage } from './useVehicleLetterRebuild'

vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof ApiModule>()
  return { ...actual, api: { ...actual.api, rebuildVehicleLetter: vi.fn() } }
})
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const rebuiltBook: BookRead = {
  id: 42, ref_number: 'FLEET-42', category_id: 'GS', subject: 'Vehicle fines', direction: 'outgoing',
  stamp_style: null, created_at: '2026-11-01T09:00:00', deleted_at: null, priority: 'Normal',
  approval_state: 'none', access_scope: 'full', confidentiality: 'general', original_creator_user_id: 7,
  can_write: true, can_send: false, can_change_confidentiality: false, can_sign: false, can_review: false,
  is_draft: false, is_word_book: false, doc_manager_has_signature: false,
  can_forward_to_branch: false, can_rebuild_vehicle_letter: false,
  included_papers_revision: 0, included_papers_fixed_page_count: 1, included_papers_total_page_count: 1,
  current_template_id: 'Vehicle Fines', service_id: 'Vehicle Fines', selected_version_id: 101,
  versions: [{
    id: 101, version_no: 2, trigger: 'generated', status: 'none', has_fields: true,
    template_id: 'Vehicle Fines', document_id: 55, created_at: '2026-11-02T09:00:00', manager_sig_embedded: false,
  }],
}

beforeEach(async () => {
  vi.resetAllMocks()
  await i18n.changeLanguage('en')
  vi.mocked(api.rebuildVehicleLetter).mockResolvedValue(rebuiltBook)
})

it('rebuilds the selected version, refreshes live detail and preserves pinned history', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const pinnedBook = { ...rebuiltBook, selected_version_id: 99, approval_state: 'returned' }
  qc.setQueryData(['books', 'detail', 42, 99], pinnedBook)
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useVehicleLetterRebuild(), { wrapper })
  act(() => result.current.mutate({ bookId: 42, versionId: 99 }))
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(api.rebuildVehicleLetter).toHaveBeenCalledWith(42, 99)
  expect(qc.getQueryData(['books', 'detail', 42])).toEqual(rebuiltBook)
  expect(qc.getQueryData(['books', 'detail', 42, null])).toEqual(rebuiltBook)
  expect(qc.getQueryData(['books', 'detail', 42, 99])).toBe(pinnedBook)
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books'] })
  expect(toast.success).toHaveBeenCalledWith(i18n.t('books.fleetReporter.rebuilt'), { reference: 'FLEET-42' })
})

it.each(['en', 'ar'])('names missing fine ids using the %s list separator', async (language) => {
  await i18n.changeLanguage(language)
  const error = new ApiError(409, 'LETTER_SOURCE_CHANGED', 'Source changed', { fine_ids: [12, 15] })
  const fines = language === 'ar' ? '#12، #15' : '#12, #15'
  const message = vehicleLetterRebuildErrorMessage(error, (key, options) => i18n.t(key, options), language)
  expect(message).toBe(i18n.t('errors.fleet.letterSourceChangedFines', { fines }))
  expect(message).toContain(fines)
})

it.each([{}, { fine_ids: [] }])('uses the generic mapped source error when fine ids are unavailable: %j', (details) => {
  const error = new ApiError(409, 'LETTER_SOURCE_CHANGED', 'Source changed', details)
  expect(vehicleLetterRebuildErrorMessage(error, (key, options) => i18n.t(key, options), 'en')).toBe(apiErrorMessage(error))
})

it('surfaces missing fine ids through the rebuild mutation error toast', async () => {
  const error = new ApiError(409, 'LETTER_SOURCE_CHANGED', 'Source changed', { fine_ids: [12, 15] })
  vi.mocked(api.rebuildVehicleLetter).mockRejectedValue(error)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useVehicleLetterRebuild(), { wrapper })
  act(() => result.current.mutate({ bookId: 42, versionId: 99 }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(i18n.t('errors.fleet.letterSourceChangedFines', { fines: '#12, #15' })))
  expect(qc.getQueryData(['books', 'detail', 42])).toBeUndefined()
})
