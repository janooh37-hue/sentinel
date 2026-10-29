import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api'
import { messageTemplatesApi } from '@/lib/messageTemplates'
import type { MessageTemplateRead } from '@/lib/messageTemplates'
import type * as MessageTemplatesModule from '@/lib/messageTemplates'
import { MessageTemplateEditor } from './MessageTemplateEditor'
import { ServiceNotificationTab } from './ServiceNotificationTab'

const { has } = vi.hoisted(() => ({ has: vi.fn() }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }))
vi.mock('@/lib/messageTemplates', async (importOriginal) => {
  const original = await importOriginal<typeof MessageTemplatesModule>()
  Object.assign(original.messageTemplatesApi, { list: vi.fn(), render: vi.fn(), save: vi.fn(), reset: vi.fn() })
  return original
})

const template: MessageTemplateRead = {
  event: 'leave_approved', label: { ar: 'اعتماد الإجازة', en: 'Leave approved' },
  group: 'leaves', services: ['leaves'], timing: 'on_approval',
  default: { ar: 'مرحبًا {name}', en: 'Hello {name}' },
  override: { ar: 'عزيزي {name}', en: 'Dear {name}' },
  variables: [{ name: 'name', label_en: 'Employee name', label_ar: 'اسم الموظف', sample: 'Ahmed' }],
}

function mount(value = template) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const editor = <QueryClientProvider client={client}><MessageTemplateEditor template={value} /></QueryClientProvider>
  const view = render(editor)
  return { ...view, refresh: () => view.rerender(<QueryClientProvider client={client}><MessageTemplateEditor template={value} /></QueryClientProvider>) }
}

beforeEach(() => {
  vi.clearAllMocks()
  has.mockReturnValue(true)
  vi.mocked(messageTemplatesApi.render).mockImplementation(async (_event, body) => ({
    text: { ar: body.ar.replace('{name}', 'Ahmed'), en: body.en.replace('{name}', 'Ahmed') },
    segments: { ar: 1, en: 1 },
  }))
  vi.mocked(messageTemplatesApi.reset).mockResolvedValue({ ...template, override: null })
  vi.mocked(messageTemplatesApi.save).mockImplementation(async (_event, body) => ({ ...template, override: body }))
})
afterEach(cleanup)

describe('MessageTemplateEditor', () => {
  it('omits a hidden notification from service lists even when its wording is cached', async () => {
    const visible = { ...template, event: 'visible_event', label: { en: 'Visible notification', ar: 'إشعار ظاهر' } }
    vi.mocked(messageTemplatesApi.list).mockResolvedValue([template, visible])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const editor = <QueryClientProvider client={client}><ServiceNotificationTab service="leaves" /></QueryClientProvider>
    const view = render(editor)
    expect(await screen.findByRole('heading', { name: template.label.en })).toBeVisible()
    has.mockImplementation((capability: string) => capability !== `messages.templates.view.notify.${template.event}`)
    view.rerender(<QueryClientProvider client={client}><ServiceNotificationTab service="leaves" /></QueryClientProvider>)
    expect(screen.queryByRole('heading', { name: template.label.en })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Visible notification' })).toBeVisible()
  })

  it('does not expose cached wording, tokens or render requests without template view access', () => {
    has.mockImplementation((capability: string) => capability === 'messages.templates')
    mount()
    expect(screen.getByRole('status')).toHaveTextContent('This template is unavailable')
    expect(screen.queryByText(template.override!.en)).not.toBeInTheDocument()
    expect(screen.queryByText(template.default.en)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(messageTemplatesApi.render).not.toHaveBeenCalled()
  })

  it('removes mounted wording and unsaved edits when template view access is revoked', async () => {
    const view = mount()
    await screen.findByText('Dear Ahmed')
    fireEvent.change(screen.getByRole('textbox', { name: 'English message' }), { target: { value: 'Unsaved wording' } })
    has.mockImplementation((capability: string) => capability !== `messages.templates.view.notify.${template.event}`)
    view.refresh()
    expect(screen.getByRole('status')).toHaveTextContent('This template is unavailable')
    expect(screen.queryByText(template.override!.en)).not.toBeInTheDocument()
    expect(screen.queryByText('Dear Ahmed')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save template' })).not.toBeInTheDocument()
  })

  it('replaces all cached wording with an unavailable state after a render 404', async () => {
    vi.mocked(messageTemplatesApi.render).mockRejectedValue(new ApiError(404, 'TEMPLATE_NOT_FOUND', 'Not found'))
    mount()
    expect(await screen.findByText('This template is unavailable or you no longer have permission to view it.')).toBeVisible()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText(template.override!.en)).not.toBeInTheDocument()
  })

  it('shows text and live previews without editing controls when capability is absent', async () => {
    has.mockImplementation((capability: string) => capability !== 'messages.templates')
    const { container } = mount()
    expect(container.querySelector('textarea')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save template' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Employee name' })).not.toBeInTheDocument()
    expect(await screen.findByText('Dear Ahmed')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByText('عزيزي Ahmed')).toHaveAttribute('dir', 'rtl')
    expect(screen.getByText('Sent after manager approval')).toBeVisible()
    expect(screen.getAllByText(/1 SMS segments/)).toHaveLength(2)
  })

  it('removes save and a pending reset confirmation when editing access is revoked', async () => {
    const view = mount()
    fireEvent.change(screen.getByRole('textbox', { name: 'English message' }), { target: { value: 'Unsaved wording' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    expect(screen.getByRole('button', { name: 'Confirm reset' })).toBeVisible()
    has.mockImplementation((capability: string) => capability !== 'messages.templates')
    view.refresh()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm reset' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save template' })).not.toBeInTheDocument()
    expect(screen.getByText(template.override!.en)).toBeVisible()
    expect(screen.queryByText('Unsaved wording')).not.toBeInTheDocument()
    expect(messageTemplatesApi.save).not.toHaveBeenCalled()
    expect(messageTemplatesApi.reset).not.toHaveBeenCalled()
  })

  it.each([403, 500])('shows saved fields and preview after a rejected save (%s) and capability revocation', async (status) => {
    vi.mocked(messageTemplatesApi.save).mockRejectedValue(new ApiError(status, 'FORBIDDEN', 'Save rejected'))
    const view = mount()
    await screen.findByText('Dear Ahmed')
    fireEvent.change(screen.getByRole('textbox', { name: 'Arabic message' }), { target: { value: 'مسودة {name}' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'English message' }), { target: { value: 'Unsaved {name}' } })
    await screen.findByText('Unsaved Ahmed')
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('textbox', { name: 'English message' })).toHaveValue('Unsaved {name}')
    expect(screen.getByText('Unsaved changes')).toBeVisible()

    has.mockImplementation((capability: string) => capability !== 'messages.templates')
    view.refresh()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText(template.override!.ar)).toBeVisible()
    expect(screen.getByText(template.override!.en)).toBeVisible()
    expect(await screen.findByText('Dear Ahmed')).toBeVisible()
    expect(screen.getByText('عزيزي Ahmed')).toBeVisible()
    expect(screen.queryByText(/Unsaved|مسودة/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save template' })).not.toBeInTheDocument()

    has.mockReturnValue(true)
    view.refresh()
    expect(screen.getByRole('textbox', { name: 'Arabic message' })).toHaveValue('مسودة {name}')
    expect(screen.getByRole('textbox', { name: 'English message' })).toHaveValue('Unsaved {name}')
    expect(screen.getByText('Unsaved changes')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save template' })).toBeEnabled()
    expect(await screen.findByText('Unsaved Ahmed')).toBeVisible()
  })

  it('inserts a variable at the selection of the last-focused language and restores its caret', () => {
    mount()
    const english = screen.getByRole('textbox', { name: 'English message' }) as HTMLTextAreaElement
    fireEvent.focus(english)
    english.setSelectionRange(0, 4)
    fireEvent.click(screen.getByRole('button', { name: 'Employee name' }))
    expect(english).toHaveValue('{name} {name}')
    expect(english).toHaveFocus()
    expect(english.selectionStart).toBe(6)
    expect(english.selectionEnd).toBe(6)
    expect(screen.getByRole('textbox', { name: 'Arabic message' })).toHaveValue(template.override!.ar)
    expect(screen.getByRole('button', { name: 'Save template' })).toBeEnabled()
  })

  it('confirms reset, calls the API, and displays both defaults', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    expect(messageTemplatesApi.reset).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reset' }))
    await waitFor(() => expect(messageTemplatesApi.reset).toHaveBeenCalledWith(template.event))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'English message' })).toHaveValue(template.default.en))
    expect(screen.getByRole('textbox', { name: 'Arabic message' })).toHaveValue(template.default.ar)
    expect(screen.queryByText('Modified')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled()
  })

  it('lists the unknown placeholders per language without losing edits', async () => {
    vi.mocked(messageTemplatesApi.save).mockRejectedValue(
      new ApiError(422, 'UNKNOWN_PLACEHOLDER', 'server message', { ar: [], en: ['missing', 'other'] }),
    )
    mount()
    const english = screen.getByRole('textbox', { name: 'English message' })
    fireEvent.change(english, { target: { value: 'Hello {missing} {other}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unknown placeholder. Use only the listed variables.')
    expect(alert).toHaveTextContent('English message: \u2068{missing}\u2069 and \u2068{other}\u2069.')
    expect(alert).not.toHaveTextContent('Arabic message')
    expect(english).toHaveValue('Hello {missing} {other}')
    expect(messageTemplatesApi.save).toHaveBeenCalledWith(template.event, { ar: template.override!.ar, en: 'Hello {missing} {other}' })
  })

  it('renders changed text after the debounce using the server segment counts', async () => {
    mount()
    await screen.findByText('Dear Ahmed')
    fireEvent.change(screen.getByRole('textbox', { name: 'English message' }), { target: { value: 'Approved {name}' } })
    expect(screen.getByRole('status')).toHaveTextContent('Updating preview')
    expect(await screen.findByText('Approved Ahmed')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByText('14 characters · 1 SMS segments')).toBeVisible()
  })
})
