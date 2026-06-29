// frontend/src/components/whatsapp/SendWhatsAppButton.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SendWhatsAppButton } from './SendWhatsAppButton'
import * as api from '../../lib/api'

// useCapabilities returns { capabilities: Set<string>, isLoading: boolean, has: (cap) => boolean }
// We use a mutable ref so individual tests can override the `has` predicate.
let mockHas: (c: string) => boolean = (c) => c === 'employees.notify'

vi.mock('../../lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: new Set(['employees.notify']),
    isLoading: false,
    has: (c: string) => mockHas(c),
  }),
}))

describe('SendWhatsAppButton', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Reset to capable by default
    mockHas = (c: string) => c === 'employees.notify'
  })

  it('shows Send when never sent, then calls sendWhatsApp on click', async () => {
    vi.spyOn(api, 'getWhatsAppStatus').mockResolvedValue({ enabled: true, last: null })
    const send = vi.spyOn(api, 'sendWhatsApp').mockResolvedValue({
      status: 'sent', message_id: 'wamid.1', error: null,
    })
    render(<SendWhatsAppButton eventType="leave_approved" recordId={7} />)
    const btn = await screen.findByRole('button')
    fireEvent.click(btn)
    await waitFor(() => expect(send).toHaveBeenCalledWith('leave_approved', 7))
  })

  it('renders nothing without the capability', async () => {
    mockHas = () => false
    vi.spyOn(api, 'getWhatsAppStatus').mockResolvedValue({ enabled: true, last: null })
    const { container } = render(<SendWhatsAppButton eventType="violation" recordId={1} />)
    // Wait a tick so the mount effect runs
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
