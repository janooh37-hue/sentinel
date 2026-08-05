import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import i18n from '@/lib/i18n'

import { NavBellPopover } from './NavBellPopover'

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useNavigate: () => navigate,
}))
vi.mock('@/pages/scanBack/useScanBack', () => ({
  useScanBack: () => ({ books: [{ id: 7 }, { id: 8 }], isLoading: false, count: 2, enabled: true }),
}))
// NavBellPopover pulls in useIdentity/useCapabilities, both of which need a
// real AuthProvider ancestor outside of App — stub the shared auth context
// module instead of standing one up, matching this suite's narrow scope.
vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ user: null, status: 'anon', login: vi.fn(), logout: vi.fn(), refetch: vi.fn(), setUser: vi.fn() }),
}))

function renderBell(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><NavBellPopover /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('bell — scan-back row', () => {
  beforeEach(async () => { navigate.mockClear(); await i18n.changeLanguage('en') })

  it('shows the row and navigates to /scan-back', async () => {
    renderBell()
    await userEvent.click(screen.getByRole('button', { name: /notification/i }))
    const row = await screen.findByText('Signed copy not filed')
    await userEvent.click(row)
    expect(navigate).toHaveBeenCalledWith('/scan-back')
  })

  it('renders Arabic under lng=ar', async () => {
    await i18n.changeLanguage('ar')
    renderBell()
    await userEvent.click(screen.getByRole('button', { name: /notification|الإشعارات/i }))
    expect(await screen.findByText('لم تُرفع النسخة الموقّعة')).toBeInTheDocument()
  })

  // Every other bell reminder (approvals, follow-ups, scan-inbox, ...) feeds
  // both the trigger's numeric badge and the `hasNothing` empty-state check.
  // Scan-back must too, or a scan-back-only inbox shows a "0" bell with an
  // empty-state message sitting right above the reminder row that disproves it.
  it('folds the scan-back count into the bell badge when nothing else is pending', async () => {
    renderBell()
    expect(await screen.findByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument()
  })

  it('does not show the empty state when scan-back is the only pending reminder', async () => {
    renderBell()
    await userEvent.click(screen.getByRole('button', { name: /notification/i }))
    await screen.findByText('Signed copy not filed')
    expect(screen.queryByText('No unread notifications')).not.toBeInTheDocument()
  })
})
