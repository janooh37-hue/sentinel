import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { api, ApiError, type BookRead, type WordSessionRead } from '@/lib/api'
import { toast } from '@/lib/toast'
import { DeriveRecordDialog } from './DeriveRecordDialog'
import { deriveGrades } from './derive-grade'

describe('derive grade floor', () => {
  const grades = ['unclassified', 'secret', 'top_secret', 'addressee_only'] as const
  it.each(grades)('allows every grade for a detached %s original', (grade) => {
    expect(deriveGrades(grade, false)).toEqual([...grades])
  })
  it('allows every grade for an attached unclassified original', () => {
    expect(deriveGrades('unclassified', true)).toEqual([...grades])
  })
  it.each(['secret', 'top_secret', 'addressee_only'] as const)(
    'excludes only unclassified for an attached %s original',
    (grade) => {
      expect(deriveGrades(grade, true)).toEqual(['secret', 'top_secret', 'addressee_only'])
    },
  )
})

const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => ({ ...await vi.importActual('react-router-dom'), useNavigate: () => navigate }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))
vi.mock('@/lib/toast', () => ({ toast: { loading: vi.fn(() => 'loading-toast'), dismiss: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/application/fields/ClassificationField', () => ({ ClassificationField: () => null }))

const book = { id: 42, ref_number: 'GS-0410', grade: 'unclassified', urgency: 'Normal', distribution: 'named', metadata_only: false, can_change_grade: false, classification_code: '1/5', access_scope: 'full' } as BookRead
function renderDerive() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(createElement(DeriveRecordDialog, { book, kind: 'reply', open: true, onOpenChange: vi.fn() }), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(MemoryRouter, null, createElement(QueryClientProvider, { client: qc }, children)),
  })
}

beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

describe('derive Word opening toast', () => {
  it('dismisses loading before navigating to the derived session', async () => {
    vi.spyOn(api, 'deriveBook').mockResolvedValue({ book_id: 43 } as WordSessionRead)
    renderDerive()
    fireEvent.click(screen.getByRole('button', { name: 'books.thread.reply' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/books/43/word'))
    expect(toast.loading).toHaveBeenCalledWith('books.word.opening')
    expect(toast.dismiss).toHaveBeenCalledWith('loading-toast')
  })

  it('morphs opening into the translated error on failure', async () => {
    vi.spyOn(api, 'deriveBook').mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Forbidden'))
    renderDerive()
    fireEvent.click(screen.getByRole('button', { name: 'books.thread.reply' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('books.thread.errors.forbidden', { id: 'loading-toast', reference: book.ref_number }))
    expect(toast.dismiss).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})
