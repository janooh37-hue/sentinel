import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'

import ar from '@/locales/ar.json'
import en from '@/locales/en.json'

import { ApiError } from '@/lib/api'
import { messageTemplatesApi } from '@/lib/messageTemplates'
import type * as DraftTemplatesModule from '@/lib/draftTemplates'
import type * as MessageTemplatesModule from '@/lib/messageTemplates'
import { EmailDraftEditor } from './EmailDraftEditor'

const { has, sample } = vi.hoisted(() => ({ has: vi.fn(), sample: vi.fn() }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }))
vi.mock('@/lib/draftTemplates', () => ({
  defaultDraftText: () => ({ subject: 'الموضوع الافتراضي', intro: 'المقدمة الافتراضية', closing: 'الخاتمة الافتراضية' }),
  renderDraftSample: sample,
}))
vi.mock('@/lib/messageTemplates', async (importOriginal) => {
  const original = await importOriginal<typeof MessageTemplatesModule>()
  Object.assign(original.messageTemplatesApi, { drafts: vi.fn(), saveDraft: vi.fn(), resetDraft: vi.fn() })
  return original
})

function mount(draftKey = 'leave:Annual') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const view = render(<QueryClientProvider client={client}><EmailDraftEditor draftKey={draftKey} label="Annual leave" /></QueryClientProvider>)
  return { ...view, refresh: () => view.rerender(<QueryClientProvider client={client}><EmailDraftEditor draftKey={draftKey} label="Annual leave" /></QueryClientProvider>) }
}

beforeEach(() => {
  vi.clearAllMocks()
  has.mockReturnValue(true)
  vi.mocked(messageTemplatesApi.drafts).mockResolvedValue({ overrides: {}, tokens: { leave: ['names'] } })
  vi.mocked(messageTemplatesApi.saveDraft).mockImplementation(async (key, body) => ({ overrides: { [key]: body }, tokens: { leave: ['names'] } }))
  vi.mocked(messageTemplatesApi.resetDraft).mockResolvedValue({ overrides: {}, tokens: { leave: ['names'] } })
  sample.mockReturnValue({ subject: 'موضوع تجريبي', bodyHtml: '<p>نص تجريبي</p>' })
})
afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

describe('EmailDraftEditor', () => {
  it('does not reconstruct default wording or sample previews for a hidden draft', async () => {
    has.mockImplementation((capability: string) => capability === 'messages.templates')
    mount()
    expect(screen.getByRole('status')).toHaveTextContent('This template is unavailable')
    expect(screen.queryByText('الموضوع الافتراضي')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(sample).not.toHaveBeenCalled()
  })

  it('unmounts cached wording and draft previews when view access is revoked', async () => {
    const view = mount()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Subject' }), { target: { value: 'عنوان غير محفوظ' } })
    has.mockImplementation((capability: string) => capability !== 'messages.templates.view.email.leave:Annual')
    view.refresh()
    expect(screen.getByRole('status')).toHaveTextContent('This template is unavailable')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText('الموضوع الافتراضي')).not.toBeInTheDocument()
    expect(screen.queryByText('موضوع تجريبي')).not.toBeInTheDocument()
  })

  it('removes wording after a hidden-template save is refused with 404', async () => {
    vi.mocked(messageTemplatesApi.saveDraft).mockRejectedValue(new ApiError(404, 'TEMPLATE_NOT_FOUND', 'Not found'))
    mount()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Subject' }), { target: { value: 'عنوان غير محفوظ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    expect(await screen.findByText('This template is unavailable or you no longer have permission to view it.')).toBeVisible()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText('موضوع تجريبي')).not.toBeInTheDocument()
  })

  it('keeps wording visible but removes edit and reset controls after capability loss', async () => {
    vi.mocked(messageTemplatesApi.drafts).mockResolvedValue({
      overrides: { 'leave:Annual': { subject: 'عنوان خاص' } }, tokens: { leave: ['names'] },
    })
    const view = mount()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Subject' }), { target: { value: 'عنوان غير محفوظ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    expect(screen.getByRole('button', { name: 'Confirm reset' })).toBeVisible()
    has.mockImplementation((capability: string) => capability !== 'messages.templates')
    view.refresh()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm reset' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save template' })).not.toBeInTheDocument()
    expect(screen.getByText('عنوان خاص')).toBeVisible()
    expect(screen.queryByText('عنوان غير محفوظ')).not.toBeInTheDocument()
    expect(messageTemplatesApi.saveDraft).not.toHaveBeenCalled()
    expect(messageTemplatesApi.resetDraft).not.toHaveBeenCalled()
  })

  it.each([403, 500])('shows saved fields and real preview after a rejected save (%s) and capability revocation', async (status) => {
    const { renderDraftSample } = await vi.importActual<typeof DraftTemplatesModule>('@/lib/draftTemplates')
    sample.mockImplementation(renderDraftSample)
    vi.mocked(messageTemplatesApi.drafts).mockResolvedValue({
      overrides: { 'leave:Annual': { subject: 'عنوان محفوظ', intro: 'مقدمة محفوظة', closing: 'خاتمة محفوظة' } },
      tokens: { leave: ['names'] },
    })
    vi.mocked(messageTemplatesApi.saveDraft).mockRejectedValue(new ApiError(status, 'FORBIDDEN', 'Save rejected'))
    const view = mount()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Subject' }), { target: { value: 'عنوان غير محفوظ' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Introduction' }), { target: { value: 'مقدمة غير محفوظة' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Closing' }), { target: { value: 'خاتمة غير محفوظة' } })
    const preview = () => within(screen.getByRole('heading', { name: 'Preview with sample data' }).parentElement!)
    expect(preview().getByText('عنوان غير محفوظ')).toBeVisible()
    expect(preview().getByText('مقدمة غير محفوظة')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveValue('عنوان غير محفوظ')
    expect(screen.getByText('Unsaved changes')).toBeVisible()

    has.mockImplementation((capability: string) => capability !== 'messages.templates')
    view.refresh()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    for (const value of ['عنوان محفوظ', 'مقدمة محفوظة', 'خاتمة محفوظة']) {
      expect(screen.getAllByText(value)).toHaveLength(2)
      expect(preview().getByText(value)).toBeVisible()
    }
    expect(screen.queryByText(/غير محفوظ/)).not.toBeInTheDocument()
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save template' })).not.toBeInTheDocument()

    has.mockReturnValue(true)
    view.refresh()
    expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveValue('عنوان غير محفوظ')
    expect(screen.getByRole('textbox', { name: 'Introduction' })).toHaveValue('مقدمة غير محفوظة')
    expect(screen.getByRole('textbox', { name: 'Closing' })).toHaveValue('خاتمة غير محفوظة')
    expect(screen.getByText('Unsaved changes')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save template' })).toBeEnabled()
    expect(preview().getByText('عنوان غير محفوظ')).toBeVisible()
  })

  it.each(['en', 'ar'] as const)('labels every draft variable in %s and inserts its raw token', async (language) => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage(language)
    const labels = (language === 'ar' ? ar : en).msgTemplates
    const tokens = ['ref', 'date', 'names', 'count', 'detail', 'bank', 'start_date', 'end_date', 'return_date']
    vi.mocked(messageTemplatesApi.drafts).mockResolvedValue({ overrides: {}, tokens: { form: tokens } })
    mount('General Book')
    const intro = await screen.findByRole('textbox', { name: labels.editor.fields.intro }) as HTMLTextAreaElement
    fireEvent.focus(intro)
    for (const token of tokens) {
      const button = screen.getByTitle(`{${token}}`)
      expect(button).toHaveAccessibleName(i18n.t(`msgTemplates.draftTokens.${token}`))
      expect(button.textContent).not.toContain(`{${token}}`)
      if (language === 'ar') expect(button.textContent).toMatch(/[\u0600-\u06ff]/)
      fireEvent.click(button)
    }
    expect(intro).toHaveValue(tokens.map((token) => `{${token}}`).join(''))
  })

  it('uses defaults for missing fields and replaces all three parts on save', async () => {
    vi.mocked(messageTemplatesApi.drafts).mockResolvedValue({ tokens: { leave: ['names'] } })
    vi.mocked(messageTemplatesApi.saveDraft).mockResolvedValue({ overrides: { 'leave:Annual': { subject: 'عنوان خاص' } }, tokens: { leave: ['names'] } })
    mount()
    const subject = await screen.findByRole('textbox', { name: 'Subject' })
    expect(subject).toHaveAttribute('dir', 'rtl')
    expect(subject).toHaveAttribute('placeholder', 'الموضوع الافتراضي')
    fireEvent.change(subject, { target: { value: 'عنوان خاص' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    await waitFor(() => expect(messageTemplatesApi.saveDraft).toHaveBeenCalledWith('leave:Annual', {
      subject: 'عنوان خاص', intro: '', closing: '',
    }))
    expect(await screen.findByText('Modified')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Introduction' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'Closing' })).toHaveValue('')
    expect(sample).toHaveBeenLastCalledWith('leave:Annual', { 'leave:Annual': { subject: 'عنوان خاص' } })
    expect(screen.getByText('نص تجريبي').parentElement).toHaveAttribute('dir', 'rtl')
  })

  it('inserts family tokens into the focused field and previews unsaved values', async () => {
    vi.mocked(messageTemplatesApi.drafts).mockResolvedValue({
      overrides: {}, tokens: { classification: ['ref', 'date', 'names', 'count', 'detail'], form: ['wrong_family'] },
    })
    mount('classification:5/1')
    const intro = await screen.findByRole('textbox', { name: 'Introduction' }) as HTMLTextAreaElement
    for (const token of ['ref', 'date', 'names', 'count', 'detail']) {
      expect(screen.getByTitle(`{${token}}`)).toBeVisible()
    }
    expect(screen.queryByTitle('{wrong_family}')).not.toBeInTheDocument()
    fireEvent.focus(intro)
    fireEvent.click(screen.getByTitle('{names}'))
    expect(intro).toHaveValue('{names}')
    expect(intro).toHaveFocus()
    expect(sample).toHaveBeenLastCalledWith('classification:5/1', { 'classification:5/1': { intro: '{names}' } })
  })

  it('shows localized plain-text validation errors', async () => {
    vi.mocked(messageTemplatesApi.saveDraft).mockRejectedValue(new ApiError(422, 'HTML_NOT_ALLOWED', 'server message'))
    mount()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Subject' }), { target: { value: '<b>عنوان</b>' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('HTML is not allowed. Enter plain text only.')
  })

  it('shows defaults and preview without inputs or mutation controls in read-only mode', async () => {
    has.mockImplementation((capability: string) => capability !== 'messages.templates')
    const { container } = mount()
    expect(await screen.findByText('المقدمة الافتراضية')).toHaveAttribute('dir', 'rtl')
    expect(container.querySelector('textarea, input')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save template' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument()
    expect(screen.getByText('نص تجريبي')).toBeVisible()
  })
})
