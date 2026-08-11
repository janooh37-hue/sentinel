import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type { IncludedPaperRead, IncludedPapersPreviewRead } from '@/lib/api'

import { useIncludedPapersEditor } from './useIncludedPapersEditor'

const paper: IncludedPaperRead = {
  id: '11111111-1111-1111-1111-111111111111',
  original_name: 'paper.pdf',
  slot_key: null,
  media_type: 'application/pdf',
  size: 100,
  page_count: 1,
  added_by_user_id: 1,
  added_at: '2026-08-10T08:00:00Z',
  page_start: 2,
  page_end: 2,
  embedded_in_signed_base: false,
}

const book = {
  id: 9,
  included_papers_revision: 3,
  included_papers: [paper],
}

function wrapper({ children }: { children: ReactNode }): React.JSX.Element {
  return createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    children,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('useIncludedPapersEditor', () => {
  it('stages selected files in order and previews the exact ordered proposal', async () => {
    const paperId = '33333333-3333-4333-8333-333333333333'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(paperId)
    const late = new File(['image'], 'late.png', { type: 'image/png' })
    const staged = {
      token: '22222222-2222-2222-2222-222222222222',
      filename: late.name,
      size: late.size,
    }
    const preview: IncludedPapersPreviewRead = {
      revision: 3,
      fixed_page_count: 1,
      total_page_count: 3,
      papers: [
        paper,
        {
          ...paper,
          id: paperId,
          original_name: staged.filename,
          media_type: late.type,
          size: staged.size,
          page_count: 1,
          page_start: 3,
          page_end: 3,
        },
      ],
      pdf_base64: 'JVBERi0=',
    }
    vi.spyOn(api, 'stageAttachment').mockResolvedValue(staged)
    const previewSpy = vi.spyOn(api, 'previewIncludedPapers').mockResolvedValue(preview)
    const { result } = renderHook(() => useIncludedPapersEditor(book), { wrapper })

    await act(() => result.current.addFiles([late]))
    expect(result.current.state.items.map((item) => item.original_name)).toEqual([
      'paper.pdf',
      'late.png',
    ])

    await act(() => result.current.previewPackage())

    await waitFor(() => expect(result.current.canSave).toBe(true))
    expect(previewSpy).toHaveBeenCalledWith(9, {
      revision: 3,
      items: [
        { id: paper.id },
        { id: paperId, staged_token: staged.token, original_name: 'late.png' },
      ],
    })
    expect(result.current.state.preview?.total_page_count).toBe(3)
  })
})
