import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { GatewayIndicator } from './GatewayIndicator'

vi.mock('@/lib/useGatewayStatus', () => ({
  useGatewayStatus: vi.fn(),
}))
import { useGatewayStatus } from '@/lib/useGatewayStatus'

function mockState(state: string | undefined, extra: Record<string, unknown> = {}) {
  vi.mocked(useGatewayStatus).mockReturnValue({
    data: state ? { state } : undefined,
    isLoading: false,
    dataUpdatedAt: Date.now(),
    ...extra,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

function renderIt() {
  return render(
    <MemoryRouter>
      <GatewayIndicator />
    </MemoryRouter>,
  )
}

describe('GatewayIndicator', () => {
  it('renders nothing when disabled', () => {
    mockState('disabled')
    const { container } = renderIt()
    expect(container.firstChild).toBeNull()
  })
  it('renders nothing while loading / no data', () => {
    mockState(undefined, { isLoading: true })
    const { container } = renderIt()
    expect(container.firstChild).toBeNull()
  })
  it('shows a connected indicator linking to broadcast', () => {
    mockState('connected')
    renderIt()
    const link = screen.getByRole('link', { name: /whatsapp connected/i })
    expect(link).toHaveAttribute('href', '/messages/broadcast')
    expect(link.querySelector('[data-state="connected"]')).not.toBeNull()
  })
  it('marks disconnected vs unreachable distinctly (no collapse)', () => {
    mockState('disconnected')
    const { rerender } = renderIt()
    expect(document.querySelector('[data-state="disconnected"]')).not.toBeNull()
    mockState('unreachable')
    rerender(
      <MemoryRouter>
        <GatewayIndicator />
      </MemoryRouter>,
    )
    expect(document.querySelector('[data-state="unreachable"]')).not.toBeNull()
  })
})
