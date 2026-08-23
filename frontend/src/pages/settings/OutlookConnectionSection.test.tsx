import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { launchOutlook } from '@/lib/outlookBridge'
import { OutlookConnectionSection } from './OutlookConnectionSection'

vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      listOutlookDevices: vi.fn(),
      createOutlookPairing: vi.fn(),
      revokeOutlookDevice: vi.fn(),
    },
  }
})

vi.mock('@/lib/outlookBridge', () => ({ launchOutlook: vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => options?.count ? `${key}:${options.count}` : key,
  }),
}))

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <OutlookConnectionSection />
    </QueryClientProvider>,
  )
}

describe('OutlookConnectionSection', () => {
  beforeEach(() => {
    vi.mocked(api.listOutlookDevices).mockResolvedValue([
      {
        id: 'device-1',
        mailbox_address: 'operator@example.test',
        device_label: 'HR desktop',
        created_at: '2026-08-20T10:00:00Z',
        last_seen_at: '2026-08-23T10:00:00Z',
        revoked_at: null,
      },
    ])
    vi.mocked(api.createOutlookPairing).mockResolvedValue({
      token: 'pair-token',
      expires_at: '2026-08-23T12:05:00Z',
    })
    vi.mocked(api.revokeOutlookDevice).mockResolvedValue(undefined)
  })

  it('pairs this PC through the classic Outlook protocol', async () => {
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'settings.outlook.pair' }))
    expect(api.createOutlookPairing).toHaveBeenCalledOnce()
    expect(launchOutlook).toHaveBeenCalledWith('gssg-outlook://pair/pair-token')
  })

  it('revokes a paired device', async () => {
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'settings.outlook.revoke' }))
    expect(api.revokeOutlookDevice).toHaveBeenCalledWith('device-1')
  })

  it('explains that pairing requires classic Outlook on desktop', async () => {
    renderSection()
    expect(await screen.findByText('settings.outlook.classicOnly')).toBeInTheDocument()
  })
})
