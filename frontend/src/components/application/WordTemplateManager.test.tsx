/**
 * WordTemplateManager — list + rename the shared General Book template library.
 * Assert Arabic under lng=ar (per i18n-tests-must-assert-arabic memory).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { WordTemplateManager } from './WordTemplateManager'
import * as apiMod from '@/lib/api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => {
      const ar: Record<string, string> = {
        'books.word.manageTemplates': 'إدارة القوالب',
        'books.word.renameTemplate': 'إعادة تسمية',
        'books.word.saveAsTemplateName': 'اسم القالب',
        'common.save': 'حفظ',
        'common.cancel': 'إلغاء',
      }
      return ar[k] ?? k
    },
    i18n: { language: 'ar' },
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('WordTemplateManager', () => {
  it('lists templates without the .docx suffix and renames one', async () => {
    const user = userEvent.setup()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(apiMod.api, 'listWordTemplates').mockResolvedValue([
      { name: 'الصيانة.docx', modified_at: '2026-07-19T10:00:00', kind: 'custom' },
      { name: 'التكليف.docx', modified_at: '2026-07-18T09:00:00', kind: 'custom' },
    ])
    const renameSpy = vi
      .spyOn(apiMod.api, 'renameWordTemplate')
      .mockResolvedValue({ name: 'صيانة المباني.docx', modified_at: '2026-07-19T10:05:00', kind: 'custom' })

    render(
      createElement(WordTemplateManager, { open: true, onOpenChange: vi.fn() }),
      { wrapper: makeWrapper(qc) },
    )

    // Listed without the Latin suffix (Arabic-name + .docx is a bidi mess)
    expect(await screen.findByText('الصيانة')).toBeInTheDocument()
    expect(screen.getByText('التكليف')).toBeInTheDocument()
    expect(screen.queryByText('الصيانة.docx')).toBeNull()

    // Rename flow: pencil → input (pre-seeded, no suffix) → save
    await user.click(screen.getAllByRole('button', { name: 'إعادة تسمية' })[0])
    const input = await screen.findByRole('textbox')
    expect(input).toHaveValue('الصيانة')
    await user.clear(input)
    await user.type(input, 'صيانة المباني')
    await user.click(screen.getByRole('button', { name: 'حفظ' }))
    await waitFor(() =>
      expect(renameSpy).toHaveBeenCalledWith('الصيانة.docx', 'صيانة المباني'),
    )
  })
})
