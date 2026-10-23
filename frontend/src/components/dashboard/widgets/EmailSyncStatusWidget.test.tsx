import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import i18n from 'i18next'
import { beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import type { DashboardSummary, EmailSyncResult } from '@/lib/api'
import type * as ApiModule from '@/lib/api'
import { toast } from '@/lib/toast'
import { EmailSyncStatusWidget } from './EmailSyncStatusWidget'

vi.mock('@/lib/toast', () => ({ toast: { loading: vi.fn(() => 'pending-sync'), dismiss: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: { syncEmail: vi.fn() },
}))

beforeEach(() => vi.clearAllMocks())

const summary: DashboardSummary = {
  totals: {
    employees_active: 0, our_staff: 0, loaned: 0, on_leave_today: 0,
    present_today: 0, forms_this_month: 0, open_violations_count: 0,
    draft_count: 0, book_draft_count: 0,
  },
  on_leave_today: [],
  upcoming_leave_ends: [],
  recent_documents: [],
  recent_ledger: [],
  email_sync: { enabled: true, incoming_today: 0, interval_minutes: 10, last_synced_at: null },
}

test.each([true, false])('resolves the pending email-sync toast (success: %s)', async (succeeds) => {
  let finish!: () => void
  vi.mocked(api.syncEmail).mockReturnValue(new Promise<EmailSyncResult>((resolve, reject) => {
    finish = () => {
      if (succeeds) resolve({ imported: 3, skipped_duplicate: 2, last_synced_at: '2026-08-01T10:00:00Z' })
      else reject(new Error('Sync failed'))
    }
  }))
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <MemoryRouter><EmailSyncStatusWidget summary={summary} /></MemoryRouter>
    </QueryClientProvider>,
  )

  await userEvent.click(screen.getByRole('button', { name: i18n.t('dashboard.widgets.emailSync.header') }))

  await waitFor(() => expect(toast.loading).toHaveBeenCalledWith(i18n.t('dashboard.widgets.emailSync.syncingToast')))
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).not.toHaveBeenCalled()
  await act(async () => { finish() })

  if (succeeds) {
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
      i18n.t('settings.email.syncOk', { imported: 3, skipped: 2 }), { id: 'pending-sync' },
    ))
    expect(toast.error).not.toHaveBeenCalled()
  } else {
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Something went wrong', { id: 'pending-sync' }))
    expect(toast.success).not.toHaveBeenCalled()
  }
})
