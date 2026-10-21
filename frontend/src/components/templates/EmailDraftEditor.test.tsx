import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api'
import { messageTemplatesApi } from '@/lib/messageTemplates'
import type * as MessageTemplatesModule from '@/lib/messageTemplates'
import { EmailDraftEditor } from './EmailDraftEditor'

const { has, sample } = vi.hoisted(() => ({ has: vi.fn(), sample: vi.fn() }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('@/lib/draftTemplates', () => ({
  defaultDraftText: () => ({ subject: 'الموضوع الافتراضي', intro: 'المقدمة الافتراضية', closing: 'الخاتمة الافتراضية' }),
  renderDraftSample: sample,
}))
vi.mock('@/lib/messageTemplates', async (importOriginal) => {
  const original = await importOriginal<typeof MessageTemplatesModule>()
  Object.assign(original.messageTemplatesApi, { drafts: vi.fn(), saveDraft: vi.fn(), resetDraft: vi.fn() })
  return original
})

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><EmailDraftEditor draftKey="leave:Annual Leave" label="Annual leave" /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  has.mockReturnValue(true)
  vi.mocked(messageTemplatesApi.drafts).mockResolvedValue({ overrides: {}, tokens: { leave: ['names'] } })
  vi.mocked(messageTemplatesApi.saveDraft).mockImplementation(async (key, body) => ({ overrides: { [key]: body }, tokens: { leave: ['names'] } }))
  vi.mocked(messageTemplatesApi.resetDraft).mockResolvedValue({ overrides: {}, tokens: { leave: ['names'] } })
  sample.mockReturnValue({ subject: 'موضوع تجريبي', bodyHtml: '<p>نص تجريبي</p>' })
})
afterEach(cleanup)

describe('EmailDraftEditor', () => {
  it('uses defaults for empty fields and saves only non-empty fields', async () => {
    mount()
    const subject = await screen.findByRole('textbox', { name: 'Subject' })
    expect(subject).toHaveAttribute('dir', 'rtl')
    expect(subject).toHaveAttribute('placeholder', 'الموضوع الافتراضي')
    expect(screen.getAllByText('Default text is used when this field is empty.')).toHaveLength(3)
    fireEvent.change(subject, { target: { value: 'عنوان خاص' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    await waitFor(() => expect(messageTemplatesApi.saveDraft).toHaveBeenCalledWith('leave:Annual Leave', { subject: 'عنوان خاص' }))
    expect(await screen.findByText('Modified')).toBeVisible()
    expect(screen.getByText('نص تجريبي').parentElement).toHaveAttribute('dir', 'rtl')
  })

  it('inserts family tokens into the focused field and previews unsaved values', async () => {
    mount()
    const intro = await screen.findByRole('textbox', { name: 'Introduction' }) as HTMLTextAreaElement
    fireEvent.focus(intro)
    fireEvent.click(screen.getByRole('button', { name: '{names}' }))
    expect(intro).toHaveValue('{names}')
    expect(intro).toHaveFocus()
    expect(sample).toHaveBeenLastCalledWith('leave:Annual Leave', { 'leave:Annual Leave': { intro: '{names}' } })
  })

  it('shows localized plain-text validation errors', async () => {
    vi.mocked(messageTemplatesApi.saveDraft).mockRejectedValue(new ApiError(422, 'HTML_NOT_ALLOWED', 'server message'))
    mount()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Subject' }), { target: { value: '<b>عنوان</b>' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('HTML is not allowed. Enter plain text only.')
  })

  it('shows defaults and preview without inputs or mutation controls in read-only mode', async () => {
    has.mockReturnValue(false)
    const { container } = mount()
    expect(await screen.findByText('المقدمة الافتراضية')).toHaveAttribute('dir', 'rtl')
    expect(container.querySelector('textarea, input')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save template' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument()
    expect(screen.getByText('نص تجريبي')).toBeVisible()
  })
})
