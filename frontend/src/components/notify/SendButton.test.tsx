import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SendButton } from './SendButton'

vi.mock('../../lib/api', () => ({
  getNotifyStatus: vi.fn().mockResolvedValue({ enabled: true, last: { channel: 'whatsapp', status: 'sent', delivery_state: 'Delivered' } }),
  sendNotify: vi.fn().mockResolvedValue({ status: 'sent', channel: 'whatsapp' }),
}))
vi.mock('../../lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

describe('SendButton', () => {
  it('shows the channel on the delivered badge', async () => {
    render(<SendButton eventType="leave_approved" recordId={1} />)
    await waitFor(() => expect(screen.getByLabelText(/whatsapp/i)).toBeInTheDocument())
  })
})
