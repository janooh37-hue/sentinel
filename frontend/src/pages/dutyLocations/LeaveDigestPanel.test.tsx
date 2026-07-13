/**
 * LeaveDigestPanel tests — preview and send flows.
 *
 * Covers:
 *  - Preview: clicking Preview calls previewLeaveDigest and shows the count
 *  - Send: clicking Send now calls sendLeaveDigest and shows the sent count
 *  - Skip rendering: skips are shown with reason label
 */
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: Record<string, unknown>) => {
    // Simulate interpolation so we can test count display
    if (opts && typeof opts.count === 'number') return `${k}:${opts.count}`
    if (opts && typeof opts.reason === 'string') return `${k}:${opts.reason}`
    return k
  }, i18n: { language: 'ar' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  api: {
    previewLeaveDigest: vi.fn(),
    sendLeaveDigest: vi.fn(),
  },
  apiErrorMessage: (e: unknown) => String(e),
}))

import userEvent from '@testing-library/user-event'
import { api } from '@/lib/api'
import { LeaveDigestPanel } from './LeaveDigestPanel'

const PREVIEW_RESULT = {
  duty_unit: 'السرية الأولى',
  month: '2026-07',
  count: 2,
  sample_ar: 'الإجازات السنوية…',
  sample_en: 'Annual leave…',
}

const SEND_RESULT_OK = { sent: 1, skips: [] }
const SEND_RESULT_SKIP = {
  sent: 0,
  skips: [{ duty_unit: 'السرية الأولى', reason: 'no_supervisor' }],
}

function renderPanel(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <LeaveDigestPanel unit="السرية الأولى" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.previewLeaveDigest).mockResolvedValue(PREVIEW_RESULT)
  vi.mocked(api.sendLeaveDigest).mockResolvedValue(SEND_RESULT_OK)
})

describe('LeaveDigestPanel', () => {
  it('shows the count after preview', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /معاينة|Preview|leaveDigest\.preview/ }))
    // The t('leaveDigest.count', {count:2}) → 'leaveDigest.count:2'
    expect(await screen.findByText(/leaveDigest\.count:2/)).toBeInTheDocument()
  })

  it('shows the sample text after preview', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /معاينة|Preview|leaveDigest\.preview/ }))
    // AR sample shown when language === 'ar'
    expect(await screen.findByText('الإجازات السنوية…')).toBeInTheDocument()
  })

  it('shows sent count after Send now', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /leaveDigest\.sendNow|Send now|إرسال/ }))
    // t('leaveDigest.sent', {count:1}) → 'leaveDigest.sent:1'
    expect(await screen.findByText(/leaveDigest\.sent:1/)).toBeInTheDocument()
  })

  it('shows skip reason labels', async () => {
    vi.mocked(api.sendLeaveDigest).mockResolvedValue(SEND_RESULT_SKIP)
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /leaveDigest\.sendNow|Send now|إرسال/ }))
    // skips with reason 'no_supervisor' should render noSupervisor label
    // t('leaveDigest.skipped', {reason: t('leaveDigest.noSupervisor')})
    await waitFor(() =>
      expect(screen.getByText(/leaveDigest\.skipped/)).toBeInTheDocument(),
    )
  })
})
