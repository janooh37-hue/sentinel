import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ScanMatchDialog } from './ScanMatchDialog'
import type { ScanInboxItem } from '../../lib/api'
import * as apiMod from '../../lib/api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

const item = { id: 7, filename: 'scan.pdf', state: 'unrouted' } as unknown as ScanInboxItem

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ScanMatchDialog item={item} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('ScanMatchDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(apiMod.api, 'scanDocumentUrl').mockReturnValue('/api/v1/scan-inbox/7/document')
    vi.spyOn(apiMod.api, 'listBooks').mockResolvedValue({ items: [], total: 0 } as never)
    vi.spyOn(apiMod.api, 'listEmployees').mockResolvedValue({
      items: [{ id: 'G1', name_en: 'Ahmed Ali', name_ar: null }],
      total: 1,
    } as never)
  })

  it('searches employees and routes the item on pick', async () => {
    const route = vi.spyOn(apiMod.api, 'routeScanItem').mockResolvedValue({} as never)
    renderDialog()
    fireEvent.change(screen.getByPlaceholderText('scanInbox.match.searchPlaceholder'), {
      target: { value: 'ahmed' },
    })
    const row = await screen.findByText('Ahmed Ali')
    fireEvent.click(row)
    await waitFor(() => expect(route).toHaveBeenCalledWith(7, { employee_id: 'G1' }))
  })
})
