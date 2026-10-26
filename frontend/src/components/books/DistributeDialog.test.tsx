import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { toast } from '@/lib/toast'
import i18n from '@/lib/i18n'
import { api, type BookDepartmentSendRead, type BookRead } from '@/lib/api'
import { DistributeDialog } from './DistributeDialog'

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const send: BookDepartmentSendRead = {
  id: 12, department_id: 5, department_name_en: 'Operations', department_name_ar: 'العمليات',
  parent_send_id: null, sent_by_user_id: 2, sent_by_name: 'Sender', sent_by_name_ar: null,
  purpose: 'info', note: null, created_at: '2026-10-12T09:00:00Z', revoked_at: null,
  heads_total: 1, heads_read: 1, members_reached: 0, done_count: 0, can_recall: false, can_distribute: true,
}
const book = { id: 7, ref_number: 'GS-7', confidentiality: 'general' } as BookRead

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'getBookDistributionOptions').mockResolvedValue({ members: [], subdepartments: [] })
  vi.spyOn(api, 'distributeBookDepartmentSend').mockResolvedValue({ sent: [], skipped: [] })
})

it('records keep with the API, refreshes book detail and routing lists, and closes after success', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const close = vi.fn()
  render(<QueryClientProvider client={client}><DistributeDialog book={book} send={send} open onOpenChange={close} /></QueryClientProvider>)
  await userEvent.click(screen.getByRole('radio', { name: 'Keep it with me' }))
  await userEvent.click(screen.getByRole('button', { name: 'Keep it with me' }))
  await waitFor(() => expect(api.distributeBookDepartmentSend).toHaveBeenCalledWith(7, 12, { mode: 'keep' }))
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books'] })
  expect(close).toHaveBeenCalledWith(false)
  expect(toast.success).toHaveBeenCalled()
})
