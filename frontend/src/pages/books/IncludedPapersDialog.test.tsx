import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type { BookRead, IncludedPaperRead, IncludedPapersPreviewRead } from '@/lib/api'

import { IncludedPapersDialog } from './IncludedPapersDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown> & { defaultValue?: string }) =>
      (options?.defaultValue ?? key).replace(
        /\{\{(\w+)\}\}/g,
        (_, name: string) => String(options?.[name] ?? `{{${name}}}`),
      ),
    i18n: { language: 'en' },
  }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/pages/application/DocPdfCanvas', () => ({
  default: ({ pdfBase64 }: { pdfBase64?: string }) => (
    <div data-testid="pdf-preview">{pdfBase64 ? 'preview PDF' : 'current PDF'}</div>
  ),
}))

const embedded: IncludedPaperRead = {
  id: '11111111-1111-1111-1111-111111111111',
  original_name: 'required.pdf',
  slot_key: 'medical_certificate',
  media_type: 'application/pdf',
  size: 100,
  page_count: 2,
  added_by_user_id: 1,
  added_at: '2026-08-10T08:00:00Z',
  page_start: null,
  page_end: null,
  embedded_in_signed_base: true,
}

const book = {
  id: 9,
  ref_number: 'HR-0467',
  subject: 'Leave Application Form',
  approval_state: 'approved',
  included_papers_revision: 3,
  included_papers_fixed_page_count: 2,
  included_papers_history: [
    {
      actor_user_id: 2,
      actor_name: 'Records manager',
      revision_before: 2,
      revision_after: 3,
      added: ['required.pdf'],
      removed: ['old.pdf'],
      replaced: [{ from_name: 'before.pdf', to_name: 'after.pdf' }],
      reordered: ['required.pdf', 'after.pdf'],
      created_at: '2026-08-10T09:00:00Z',
    },
    {
      actor_user_id: 3,
      actor_name: 'Minimal manager',
      revision_before: 1,
      revision_after: 2,
      removed: ['legacy.pdf'],
      created_at: '2026-08-09T09:00:00Z',
    },
  ],
  included_papers_total_page_count: 4,
  included_papers: [embedded],
}

function wrapper({ children }: { children: ReactNode }): React.JSX.Element {
  return createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    children,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('IncludedPapersDialog', () => {
  it('keeps the form and embedded paper fixed, then reviews and saves one ordered package', async () => {
    const paperId = '33333333-3333-4333-8333-333333333333'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(paperId)
    const user = userEvent.setup()
    const late = new File(['image'], 'passport.jpg', { type: 'image/jpeg' })
    const staged = {
      token: '22222222-2222-2222-2222-222222222222',
      filename: late.name,
      size: late.size,
    }
    const preview: IncludedPapersPreviewRead = {
      revision: 3,
      fixed_page_count: 2,
      total_page_count: 5,
      papers: [
        embedded,
        {
          ...embedded,
          id: paperId,
          original_name: staged.filename,
          slot_key: null,
          media_type: late.type,
          size: staged.size,
          page_count: 1,
          page_start: 5,
          page_end: 5,
          embedded_in_signed_base: false,
        },
      ],
      pdf_base64: 'JVBERi0=',
    }
    vi.spyOn(api, 'stageAttachment').mockResolvedValue(staged)
    vi.spyOn(api, 'previewIncludedPapers').mockResolvedValue(preview)
    const saveSpy = vi
      .spyOn(api, 'saveIncludedPapers')
      .mockResolvedValue(undefined as unknown as BookRead)
    const onOpenChange = vi.fn()
    render(
      <IncludedPapersDialog
        open
        onOpenChange={onOpenChange}
        book={book}
        currentPdfUrl="/api/v1/documents/4/download?format=pdf"
      />,
      { wrapper },
    )

    expect(screen.getByText('Generated form')).toBeVisible()
    expect(screen.getAllByText('required.pdf').length).toBeGreaterThan(0)
    expect(screen.getByText('Fixed in signed PDF')).toBeVisible()
    expect(screen.getByText('Records manager')).toBeVisible()
    expect(screen.getByText('Minimal manager')).toBeVisible()
    expect(screen.getByText('Added:')).toBeVisible()
    expect(screen.getAllByText('Removed:')).toHaveLength(2)
    expect(screen.getByText('Replaced:')).toBeVisible()
    expect(screen.getByText('with')).toHaveClass('sr-only')
    expect(screen.getByText('→')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Reordered:')).toBeVisible()
    expect(screen.getByText('Reordered:').parentElement).toHaveTextContent(
      'Reordered: required.pdf, after.pdf',
    )
    expect(screen.queryByRole('button', { name: 'Remove required.pdf' })).not.toBeInTheDocument()
    expect(screen.queryByText('Not reviewed yet')).not.toBeInTheDocument()

    await user.upload(screen.getByLabelText('Add PDF or images'), late)
    expect(await screen.findByText('passport.jpg')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Discard unsaved changes?')).toBeVisible()
    expect(screen.getByText('Your changes have not been saved.')).toBeVisible()
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save combined PDF' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Review PDF' }))
    await waitFor(() => expect(screen.getByTestId('pdf-preview')).toHaveTextContent('preview PDF'))
    expect(screen.getByRole('button', { name: 'Save combined PDF' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Save combined PDF' }))
    expect(saveSpy).toHaveBeenCalledWith(9, {
      revision: 3,
      items: [
        { id: embedded.id },
        { id: paperId, staged_token: staged.token, original_name: staged.filename },
      ],
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
