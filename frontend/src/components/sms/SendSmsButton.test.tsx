// frontend/src/components/sms/SendSmsButton.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SendSmsButton } from './SendSmsButton'
import * as api from '../../lib/api'

let mockHas: (c: string) => boolean = (_cap: string) => true
vi.mock('../../lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (c: string) => mockHas(c) }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

describe('SendSmsButton', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockHas = () => true
  })

  it('sends an SMS when clicked', async () => {
    vi.spyOn(api, 'getSmsStatus').mockResolvedValue({ enabled: true, last: null })
    vi.spyOn(api, 'sendSms').mockResolvedValue({ status: 'sent', message_id: 'sms-1', error: null })
    render(<SendSmsButton eventType="leave_approved" recordId={7} />)
    const btn = await screen.findByRole('button')
    fireEvent.click(btn)
    await waitFor(() => expect(api.sendSms).toHaveBeenCalledWith('leave_approved', 7))
  })

  it('renders nothing without the notify capability', async () => {
    mockHas = () => false
    vi.spyOn(api, 'getSmsStatus').mockResolvedValue({ enabled: true, last: null })
    const { container } = render(<SendSmsButton eventType="violation" recordId={1} />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('renders nothing when the channel is disabled', async () => {
    vi.spyOn(api, 'getSmsStatus').mockResolvedValue({ enabled: false, last: null })
    const { container } = render(<SendSmsButton eventType="violation" recordId={1} />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('renders the send button for a book service record event type', async () => {
    vi.spyOn(api, 'getSmsStatus').mockResolvedValue({ enabled: true, last: null })
    render(<SendSmsButton eventType="salary_transfer" recordId={42} />)
    const btn = await screen.findByRole('button')
    expect(btn).toBeInTheDocument()
  })

  it('offers resend when the last send was accepted but failed delivery', async () => {
    vi.spyOn(api, 'getSmsStatus').mockResolvedValue({
      enabled: true,
      last: {
        status: 'sent',
        delivery_state: 'Failed',
        event_type: 'leave_approved',
        event_ref: 'leave_approved:1',
        language: 'ar',
        error: null,
        created_at: new Date().toISOString(),
      },
    })
    render(<SendSmsButton eventType="leave_approved" recordId={1} />)
    const btn = await screen.findByRole('button')
    // Should show "resend" (i.e., sms.resend key which the mock returns as-is)
    expect(btn.textContent).toMatch(/resend/i)
    // Should NOT show the done checkmark
    const checkmark = screen.queryByLabelText('sent')
    expect(checkmark).not.toBeInTheDocument()
  })
})
