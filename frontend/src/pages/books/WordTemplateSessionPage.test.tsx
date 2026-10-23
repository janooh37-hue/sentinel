import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ar from '@/locales/ar.json'
import { api } from '@/lib/api'
import type { TemplateSessionRead } from '@/lib/api'
import { WordTemplateSessionPage } from './WordTemplateSessionPage'

void i18n.use(initReactI18next).init({ lng: 'ar', resources: { ar: { translation: ar } }, interpolation: { escapeValue: false } })
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => 'loading-toast'), dismiss: vi.fn() } }))
vi.mock('@/pages/application/DocPdfCanvas', () => ({ default: ({ pdfUrl }: { pdfUrl: string }) => <div data-testid="paper" data-url={pdfUrl} /> }))
const session: TemplateSessionRead = { id: 9, name: 'قالب.docx', token: 'tpl', filename: 'template.docx', word_url: 'ms-word:ofe|u|https://gssg.lan/dav/tpl/template.docx', dav_url: 'https://gssg.lan/dav/tpl/template.docx', created_at: '2026-10-12T10:00:00Z', last_put_at: null }
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/books/word-templates/9']}><Routes><Route path="/books/word-templates/:sessionId" element={<WordTemplateSessionPage />} /><Route path="/books" element={<div>books</div>} /></Routes></MemoryRouter></QueryClientProvider>)
  return qc
}
beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'getTemplateSession').mockResolvedValue(session)
})
it('gates template Finish on a Word save, then installs it and returns to Records', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'finishTemplateSession').mockResolvedValue({ name: session.name, modified_at: session.created_at, kind: 'custom' })
  const qc = setup()
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  expect(await screen.findByRole('heading', { name: 'قالب' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'فتح في Word' })).toHaveAttribute('href', session.word_url)
  const finish = screen.getByRole('button', { name: 'حفظ في مكتبة القوالب' })
  expect(finish).toBeDisabled()
  qc.setQueryData(['word-template-session', 9], { ...session, last_put_at: '2026-10-12T10:05:00Z' })
  await waitFor(() => expect(finish).toBeEnabled())
  expect(await screen.findByTestId('paper')).toHaveAttribute('data-url', api.templateSessionPreviewUrl(9, '2026-10-12T10:05:00Z'))
  await user.click(finish)
  expect(await screen.findByText('books')).toBeVisible()
  expect(api.finishTemplateSession).toHaveBeenCalledWith(9)
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['word-templates'] })
})
it('discards only after confirming the template-specific warning', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'discardTemplateSession').mockResolvedValue(undefined)
  setup()
  await user.click(await screen.findByRole('button', { name: 'إلغاء المسودة…' }))
  expect(api.discardTemplateSession).not.toHaveBeenCalled()
  const dialog = screen.getByRole('dialog')
  expect(dialog).toHaveTextContent('لن تُضاف إلى المكتبة المشتركة')
  await user.click(within(dialog).getByRole('button', { name: 'إلغاء المسودة' }))
  expect(await screen.findByText('books')).toBeVisible()
  expect(api.discardTemplateSession).toHaveBeenCalledWith(9)
})
