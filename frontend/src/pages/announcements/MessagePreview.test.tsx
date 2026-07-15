import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PhonePreview, WebChatWindow } from './MessagePreview'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

const base = { groupName: 'Duty Officers', text: '', mentionNames: [], attachment: null }

describe('PhonePreview', () => {
  it('shows group name and live text', () => {
    render(<PhonePreview {...base} text="Hello team" />)
    expect(screen.getByText('Duty Officers')).toBeInTheDocument()
    expect(screen.getByText('Hello team')).toBeInTheDocument()
  })
  it('highlights mention tokens', () => {
    render(<PhonePreview {...base} text="Hi @Omar!" mentionNames={['Omar']} />)
    const tag = screen.getByText('@Omar')
    expect(tag.className).toContain('wa-mention')
  })
  it('renders attachment chip only when provided', () => {
    const { rerender } = render(<PhonePreview {...base} />)
    expect(screen.queryByTestId('preview-attachment')).not.toBeInTheDocument()
    rerender(<PhonePreview {...base} attachment={{ title: 'GSSG-2026-0417.pdf' }} />)
    expect(screen.getByTestId('preview-attachment')).toBeInTheDocument()
  })
  it('bubble fills the phone width (spec: 94%)', () => {
    render(<PhonePreview {...base} text="x" />)
    expect(screen.getByTestId('preview-bubble').className).toContain('max-w-[94%]')
  })
})

describe('WebChatWindow', () => {
  it('renders the same message content', () => {
    render(<WebChatWindow {...base} text="Hello web" />)
    expect(screen.getByText('Hello web')).toBeInTheDocument()
  })
})
