import { cleanup, fireEvent, render as renderComponent, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'

import ar from '@/locales/ar.json'
import { messageTemplatesApi } from '@/lib/messageTemplates'
import type * as MessageTemplatesModule from '@/lib/messageTemplates'
import { GeneratedSaveActions } from './GeneratedSaveActions'

vi.mock('@/lib/messageTemplates', async (importOriginal) => {
  const actual = await importOriginal<typeof MessageTemplatesModule>()
  Object.assign(actual.messageTemplatesApi, { preview: vi.fn() })
  return actual
})

function render(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderComponent(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
}

beforeEach(async () => {
  await i18n.addResourceBundle('ar', 'translation', ar, true, true)
  await i18n.changeLanguage('ar')
  vi.mocked(messageTemplatesApi.preview).mockResolvedValue({
    event: 'leave_permit',
    language: 'ar',
    timing: 'on_approval',
    text: { ar: 'تفاصيل رسالة التصريح', en: 'Permit message details' },
    segments: { ar: 1, en: 1 },
  })
})

afterEach(() => {
  cleanup()
  void i18n.changeLanguage('en')
})

describe('GeneratedSaveActions', () => {
  const baseProps = {
    signingPath: 'auto' as const,
    showNotify: true,
    notifyEmployee: true,
    notifyDisabled: false,
    saveDisabled: false,
    saving: false,
    hint: 'أكمل المرفقات المطلوبة أولًا',
    previewBody: {
      template_id: 'Leave Permit Form',
      employee_id: 'G1',
      fields: { duration_hours: '3' },
      revise_of_book_id: null,
    },
    onNotifyChange: vi.fn(),
    onSave: vi.fn(),
  }

  it('renders the Arabic ready-to-save title', () => {
    render(<GeneratedSaveActions {...baseProps} />)

    expect(screen.getByText('جاهز للحفظ في السجلات')).toBeVisible()
  })

  it('keeps the revision message preview visible when the notify switch is hidden', async () => {
    const { rerender } = render(<GeneratedSaveActions {...baseProps} showNotify />)
    expect(screen.getByRole('switch', { name: 'إشعار الموظف' })).toBeVisible()
    expect(await screen.findByText('تفاصيل رسالة التصريح')).toBeVisible()

    const revisionBody = { ...baseProps.previewBody, revise_of_book_id: 42 }
    rerender(<GeneratedSaveActions {...baseProps} showNotify={false} previewBody={revisionBody} />)
    expect(screen.queryByRole('switch', { name: 'إشعار الموظف' })).not.toBeInTheDocument()
    expect(await screen.findByText('تفاصيل رسالة التصريح')).toBeVisible()
  })

  it('names WhatsApp before the SMS fallback when notification is on', () => {
    render(<GeneratedSaveActions {...baseProps} />)

    expect(screen.getByText(/واتساب، ثم الرسائل النصية كخيار بديل/)).toBeVisible()
  })

  it.each([
    {
      language: 'ar',
      onSaveHint: /سيصل الموظف إشعار عند حفظ هذا النموذج/,
      atApprovalHint: /سيصل الموظف إشعار بعد اعتماد المدير لهذا النموذج/,
    },
    {
      language: 'en',
      onSaveHint: /The employee will get a message when this form is saved/,
      atApprovalHint: /The employee will get a message once the manager approves this form/,
    },
  ])('tells the operator a chain form notifies on manager approval ($language)', async ({
    language,
    onSaveHint,
    atApprovalHint,
  }) => {
    await i18n.changeLanguage(language)
    const { rerender } = render(<GeneratedSaveActions {...baseProps} signingPath="chain" />)
    expect(screen.getByText(atApprovalHint)).toBeVisible()
    expect(screen.queryByText(onSaveHint)).not.toBeInTheDocument()

    rerender(<GeneratedSaveActions {...baseProps} signingPath="auto" />)
    expect(screen.getByText(onSaveHint)).toBeVisible()
    expect(screen.queryByText(atApprovalHint)).not.toBeInTheDocument()
  })

  it('uses the saved-without-notifying hint when notification is off', () => {
    render(<GeneratedSaveActions {...baseProps} notifyEmployee={false} />)

    expect(screen.getByText('سيتم الحفظ دون إشعار الموظف.')).toBeVisible()
  })

  it('invokes onSave once from the save button', () => {
    const onSave = vi.fn()
    render(<GeneratedSaveActions {...baseProps} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: 'حفظ في السجلات' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('disables both notification and save controls while saving', () => {
    render(<GeneratedSaveActions {...baseProps} saving />)

    expect(screen.getByRole('switch', { name: 'إشعار الموظف' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'حفظ في السجلات' })).toBeDisabled()
  })

  it('keeps notification available when only save is disabled', () => {
    render(<GeneratedSaveActions {...baseProps} saveDisabled />)

    expect(screen.getByRole('switch', { name: 'إشعار الموظف' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'حفظ في السجلات' })).toBeDisabled()
  })
})
