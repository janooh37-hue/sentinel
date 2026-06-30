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
})
