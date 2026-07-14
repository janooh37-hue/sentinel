/**
 * GatewayConnectDialog tests — QR image render + step instructions.
 *
 * Mirrors the harness in SendToGroupPage.test.tsx:
 *   QueryClientProvider + i18n stub + vi.mock('@/lib/api') + sonner mock.
 *
 * Strategy: assert initial render only; no fake timers needed since we only
 * check that the QR img and the 3 step texts appear after the query resolves.
 */
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en' },
  }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../lib/api', () => ({
  api: {
    gatewayQr: vi.fn().mockResolvedValue({ qr: 'data:image/png;base64,AAAA' }),
    gatewayStatus: vi.fn().mockResolvedValue({ state: 'disconnected' }),
  },
}))

import { api } from '../../lib/api'
import { GatewayConnectDialog } from './GatewayConnectDialog'

function renderDialog(open = true): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <GatewayConnectDialog open={open} onOpenChange={() => undefined} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.gatewayQr).mockResolvedValue({ qr: 'data:image/png;base64,AAAA' })
  vi.mocked(api.gatewayStatus).mockResolvedValue({ state: 'disconnected' })
})

describe('GatewayConnectDialog', () => {
  it('renders the QR image when a data-url is returned', async () => {
    renderDialog()
    const img = await screen.findByRole('img', { name: /qr/i })
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAAA')
  })

  it('renders all 3 step instructions', async () => {
    renderDialog()
    expect(await screen.findByText('sendToGroup.qr.step1')).toBeInTheDocument()
    expect(screen.getByText('sendToGroup.qr.step2')).toBeInTheDocument()
    expect(screen.getByText('sendToGroup.qr.step3')).toBeInTheDocument()
  })

  it('renders dialog title', async () => {
    renderDialog()
    expect(await screen.findByText('sendToGroup.qr.dialogTitle')).toBeInTheDocument()
  })

  it('shows qrError when qr is null', async () => {
    vi.mocked(api.gatewayQr).mockResolvedValue({ qr: null })
    renderDialog()
    expect(await screen.findByText('sendToGroup.qr.qrError')).toBeInTheDocument()
  })
})
