import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { api, type BookRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { LinkRecordDialog } from './LinkRecordDialog'

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await i18n.changeLanguage('en') })

it('result rows follow the document direction; the reference number stays isolated left-to-right', async () => {
  await i18n.changeLanguage('ar')
  vi.spyOn(api, 'listBooks').mockResolvedValue({
    items: [{ id: 9, ref_number: '1/2/9', subject: 'خطة الإجازات', grade: 'unclassified', access_scope: 'full' }],
  } as never)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LinkRecordDialog book={{ id: 1, can_write: true, access_scope: 'full' } as BookRead} open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  )
  const row = await screen.findByRole('button', { name: /1\/2\/9/ })
  const ref = screen.getByText('1/2/9')
  expect(ref.tagName).toBe('BDI')
  expect(ref).toHaveAttribute('dir', 'ltr')
  // The wrapping blocks align to the start edge (right in Arabic) rather than pinning a physical direction.
  expect(ref.parentElement).toHaveClass('text-start')
  expect(ref.parentElement).not.toHaveAttribute('dir')
  expect(screen.getByText('خطة الإجازات').parentElement).toHaveClass('text-start')
  expect(row).toHaveClass('text-start')
})
