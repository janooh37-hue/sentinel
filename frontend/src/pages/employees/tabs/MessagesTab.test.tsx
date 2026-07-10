import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
const BADGE_LABELS: Record<string, string> = {
  'employee.messages.delivered': 'Delivered',
  'employee.messages.failed': 'Failed',
  'employee.messages.pending': 'Sent · awaiting confirmation',
}
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => BADGE_LABELS[k] ?? k, i18n: { language: 'en' } }) }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => false }) }))
import { MessagesTab } from './MessagesTab'

const base = { id: 1, event_type: 'warning', phone: '+971500000000', language: 'ar', created_at: '2026-07-06T10:00:00Z' }

describe('MessagesTab', () => {
  it('renders a sent message with its body', () => {
    render(<MessagesTab messages={[{ ...base, body: 'عزيزي محمد', status: 'sent', error: null }]} />)
    expect(screen.getByText('عزيزي محمد')).toBeInTheDocument()
  })
  it('renders a failed message with its error', () => {
    render(<MessagesTab messages={[{ ...base, body: 'x', status: 'failed', error: 'No valid phone number' }]} />)
    expect(screen.getByText(/No valid phone number/)).toBeInTheDocument()
  })
  it('shows empty state', () => {
    render(<MessagesTab messages={[]} />)
    expect(screen.getByText('employee.messages.empty')).toBeInTheDocument()
  })

  it('shows a Delivered badge when the gateway confirms delivery', () => {
    render(<MessagesTab messages={[{ id: 1, event_type: 'leave_requested', body: 'x',
      phone: '+971', status: 'sent', delivery_state: 'Delivered', error: null,
      language: 'en', created_at: new Date().toISOString() } as any]} />)
    expect(screen.getByText('Delivered')).toBeInTheDocument()
  })

  it('shows a Failed badge when status=sent but delivery_state=Failed', () => {
    render(<MessagesTab messages={[{ id: 2, event_type: 'leave_requested', body: 'x',
      phone: '+971', status: 'sent', delivery_state: 'Failed',
      error: 'RESULT_ERROR_GENERIC_FAILURE', language: 'en',
      created_at: new Date().toISOString() } as any]} />)
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText(/GENERIC_FAILURE/)).toBeInTheDocument()
  })

  it('shows an awaiting-confirmation badge when accepted but unconfirmed', () => {
    render(<MessagesTab messages={[{ id: 3, event_type: 'leave_requested', body: 'x',
      phone: '+971', status: 'sent', delivery_state: null, error: null,
      language: 'en', created_at: new Date().toISOString() } as any]} />)
    expect(screen.getByText(/awaiting confirmation/i)).toBeInTheDocument()
  })
})
