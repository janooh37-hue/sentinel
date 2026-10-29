import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'

import { DEFAULT_QUERY_STALE_TIME } from '@/App'
import type * as MessageTemplatesModule from '@/lib/messageTemplates'
import ar from '@/locales/ar.json'
import { messageTemplatesApi, useSaveMessageTemplate, type NotifyPreviewRequest, type NotifyPreviewResponse } from '@/lib/messageTemplates'
import { ApiError } from '@/lib/api'
import { NotifyMessagePreview } from './NotifyMessagePreview'

vi.mock('@/lib/messageTemplates', async (importOriginal) => {
  const actual = await importOriginal<typeof MessageTemplatesModule>()
  Object.assign(actual.messageTemplatesApi, { preview: vi.fn(), save: vi.fn() })
  return actual
})

const body: NotifyPreviewRequest = {
  template_id: 'Leave Permit Form',
  employee_id: 'G1',
  fields: { duration_hours: '3' },
  revise_of_book_id: null,
}
const response: NotifyPreviewResponse = {
  event: 'leave_permit',
  language: 'en',
  timing: 'on_approval',
  text: { en: 'Your permit lasts 3 hours.', ar: 'مدة التصريح ٣ ساعات.' },
  segments: { en: 1, ar: 2 },
}
const preview = vi.mocked(messageTemplatesApi.preview)

function renderPreview(notifyEmployee = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<NotifyMessagePreview body={body} notifyEmployee={notifyEmployee} />, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
}

beforeEach(async () => {
  await i18n.addResourceBundle('ar', 'translation', ar, true, true)
  await i18n.changeLanguage('en')
  preview.mockResolvedValue(response)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('NotifyMessagePreview', () => {
  it('reports a hidden preview as unavailable without exposing cached wording', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    render(<NotifyMessagePreview body={body} notifyEmployee />, { wrapper })
    expect(await screen.findByText(response.text!.en)).toBeVisible()
    preview.mockRejectedValue(new ApiError(404, 'TEMPLATE_NOT_FOUND', 'Not found'))
    await act(async () => { await client.invalidateQueries({ queryKey: ['notify-preview'] }) })
    expect(await screen.findByText("Message preview isn't available for your account. Sending is not affected.")).toBeVisible()
    expect(screen.queryByText(response.text!.en)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arabic' })).not.toBeInTheDocument()
  })

  it.each(['EMPLOYEE_NOT_FOUND', 'BOOK_NOT_FOUND'])('does not describe %s as a hidden template', async (code) => {
    preview.mockRejectedValue(new ApiError(404, code, 'Not found'))
    renderPreview()
    expect(await screen.findByText(i18n.t('msgTemplates.preview.error'))).toBeVisible()
    expect(screen.queryByText(i18n.t('msgTemplates.preview.hidden'))).not.toBeInTheDocument()
  })

  it('refreshes a remounted save-screen preview after a template edit with production staleTime', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: DEFAULT_QUERY_STALE_TIME } },
    })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const initial = render(<NotifyMessagePreview body={body} notifyEmployee />, { wrapper })
    expect(await screen.findByText(response.text!.en)).toBeVisible()
    initial.unmount()

    const updated = { en: 'Your updated permit message.', ar: 'رسالة التصريح المحدّثة.' }
    vi.mocked(messageTemplatesApi.save).mockImplementation(async (event, text) => {
      preview.mockResolvedValue({ ...response, text })
      return {
        event, label: { en: 'Permit', ar: 'تصريح' }, group: 'forms',
        services: [body.template_id], timing: 'on_approval',
        default: response.text!, override: text, variables: [],
      }
    })
    const save = renderHook(() => useSaveMessageTemplate(), { wrapper })
    await act(async () => {
      await save.result.current.mutateAsync({ event: response.event!, body: updated })
    })
    render(<NotifyMessagePreview body={body} notifyEmployee />, { wrapper })
    expect(await screen.findByText(updated.en)).toBeVisible()
    expect(screen.queryByText(response.text!.en)).not.toBeInTheDocument()
  })

  it.each(['en', 'ar'] as const)('shows employee language %s first, with the other one a tap away', async (language) => {
    preview.mockResolvedValue({ ...response, language })
    renderPreview()
    const initialText = language === 'en' ? 'Your permit lasts 3 hours.' : 'مدة التصريح 3 ساعات.'
    const otherText = language === 'en' ? 'مدة التصريح 3 ساعات.' : 'Your permit lasts 3 hours.'
    const initial = await screen.findByText(initialText)
    expect(initial).toHaveAttribute('lang', language)
    expect(initial).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr')
    expect(screen.queryByText(otherText)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: language === 'ar' ? 'Arabic' : 'English' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: language === 'ar' ? 'English' : 'Arabic' }))
    const other = screen.getByText(otherText)
    expect(other).toHaveAttribute('lang', language === 'ar' ? 'en' : 'ar')
    expect(other).toHaveAttribute('dir', language === 'ar' ? 'ltr' : 'rtl')
    expect(screen.getByRole('button', { name: language === 'ar' ? 'English' : 'Arabic' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText(initialText)).not.toBeInTheDocument()
    expect(screen.getByText(language === 'ar' ? '1 SMS segment' : '2 SMS segments')).toBeVisible()
  })

  it.each([
    ['en', 'on_approval', 'Sent after manager approval'],
    ['en', 'on_save', 'Sent when saved'],
    ['ar', 'on_approval', 'تُرسل بعد اعتماد المدير'],
    ['ar', 'on_save', 'تُرسل عند الحفظ'],
  ] as const)('explains %s timing %s', async (language, timing, label) => {
    await i18n.changeLanguage(language)
    preview.mockResolvedValue({ ...response, timing })
    renderPreview()
    expect(await screen.findByText(label)).toBeVisible()
  })

  it('debounces the complete unsaved request body for 500ms', async () => {
    const { rerender } = renderPreview()
    await screen.findByText('Your permit lasts 3 hours.')
    expect(preview).toHaveBeenCalledWith(body)
    preview.mockClear()
    vi.useFakeTimers()
    rerender(<NotifyMessagePreview body={{ ...body, fields: { duration_hours: '4' } }} notifyEmployee />)
    await act(async () => vi.advanceTimersByTimeAsync(300))
    const changed: NotifyPreviewRequest = {
      template_id: 'Administrative Leave Form',
      employee_id: 'G2',
      fields: { days: 12, notes: 'Current unsaved notes' },
      revise_of_book_id: 42,
    }
    rerender(<NotifyMessagePreview body={changed} notifyEmployee />)
    await act(async () => vi.advanceTimersByTimeAsync(499))
    expect(preview).not.toHaveBeenCalled()
    expect(screen.getByRole('status', { name: 'Loading employee message preview' })).toBeVisible()
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(preview).toHaveBeenCalledExactlyOnceWith(changed)
  })

  it('keeps the preview dimmed and explicitly says it will not send when switched off', async () => {
    renderPreview(false)
    expect(await screen.findByText('Will not be sent')).toBeVisible()
    expect(screen.getByText('Your permit lasts 3 hours.').parentElement).toHaveClass('opacity-60')
    expect(screen.queryByText('Sent after manager approval')).not.toBeInTheDocument()
  })

  it('shows a loading skeleton while waiting for the response', () => {
    // The project's ES2023 lib predates Promise.withResolvers.
    preview.mockReturnValue(new Promise<NotifyPreviewResponse>(() => {}))
    renderPreview()
    expect(screen.getByRole('status', { name: 'Loading employee message preview' })).toBeVisible()
  })

  it('quietly reports that this form has no employee message', async () => {
    preview.mockResolvedValue({ ...response, event: null, text: null, segments: null })
    renderPreview()
    expect(await screen.findByText('No message is sent to the employee for this form.')).toBeVisible()
    expect(screen.queryByRole('group', { name: 'Preview language' })).not.toBeInTheDocument()
  })

  it('keeps preview errors inline without blocking the save workflow', async () => {
    preview.mockRejectedValue(new Error('Unavailable'))
    renderPreview()
    expect(await screen.findByText('Message preview is unavailable. You can still save.')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(preview).toHaveBeenCalledTimes(1)
  })
})
