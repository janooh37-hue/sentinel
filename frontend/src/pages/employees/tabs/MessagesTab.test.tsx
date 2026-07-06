import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }) }))
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
})
