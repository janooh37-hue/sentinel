import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { GatewayIndicator } from './GatewayIndicator'

vi.mock('@/lib/useGatewayStatus', () => ({ useGatewayStatus: vi.fn() }))
import { useGatewayStatus } from '@/lib/useGatewayStatus'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

function mockState(state: string | undefined, extra: Record<string, unknown> = {}) {
  ;(useGatewayStatus as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: state ? { state } : undefined,
    isLoading: false,
    dataUpdatedAt: Date.now(),
    ...extra,
  })
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

  it('shows a trigger with the connected dot and no open panel initially', () => {
    mockState('connected')
    renderIt()
    const trigger = screen.getByRole('button', { name: /whatsapp/i })
    expect(trigger.querySelector('[data-state="connected"]')).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
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

  it('opens a panel with a Send-to-Group link that navigates to /messages/broadcast', async () => {
    mockState('connected')
    renderIt()
    await userEvent.click(screen.getByRole('button', { name: /whatsapp/i }))
    const panel = screen.getByRole('dialog')
    expect(panel).toBeInTheDocument()
    const link = screen.getByRole('button', { name: /nav\.sendToGroup|send to group/i })
    await userEvent.click(link)
    expect(navigateMock).toHaveBeenCalledWith('/messages/broadcast')
  })
})
