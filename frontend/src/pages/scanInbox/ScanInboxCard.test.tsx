import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ScanInboxCard } from './ScanInboxCard'
import type { ScanInboxItem } from '../../lib/api'
import * as apiMod from '../../lib/api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.dest ? `${k}:${o.dest}` : k),
    i18n: { language: 'en' },
  }),
}))

function base(overrides: Partial<ScanInboxItem>): ScanInboxItem {
  return {
    id: 1, filename: 'scan.pdf', state: 'unrouted', fields: {}, candidates: [],
    proposed_route: null, proposed_ref: null, proposed_employee_id: null,
    proposed_employee_name_en: null, proposed_employee_name_ar: null,
    proposed_book_id: null, confidence_tier: 'manual', document_type: null,
    email_sender: null, email_subject: null, ledger_entry_id: null,
    ...overrides,
  } as ScanInboxItem
}

function renderCard(item: ScanInboxItem) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ScanInboxCard item={item} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ScanInboxCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(apiMod.api, 'scanDocumentUrl').mockReturnValue('/x')
  })

  it('files an unrouted item via a candidate chip', async () => {
    const route = vi.spyOn(apiMod.api, 'routeScanItem').mockResolvedValue({} as never)
    renderCard(base({
      candidates: [{ employee_id: 'G1', name_en: 'Ahmed Ali', name_ar: null, score: 0.82 }],
    }))
    fireEvent.click(screen.getByText(/scanInbox.fileTo:Ahmed Ali/))
    await waitFor(() => expect(route).toHaveBeenCalledWith(1, { employee_id: 'G1' }))
  })

  it('shows a destination deep-link for an auto-filed item', () => {
    renderCard(base({
      state: 'auto_filed', proposed_route: 'employee_doc',
      proposed_employee_id: 'G5', proposed_employee_name_en: 'Sara Omar',
    }))
    const link = screen.getByText('scanInbox.openInFile').closest('a')
    expect(link).toHaveAttribute('href', '/employees/G5')
  })

  it('re-match: undo is called then ScanMatchDialog opens', async () => {
    const undo = vi.spyOn(apiMod.api, 'undoScanItem').mockResolvedValue({} as never)
    vi.spyOn(apiMod.api, 'listEmployees').mockResolvedValue({ items: [], total: 0 } as never)
    vi.spyOn(apiMod.api, 'listBooks').mockResolvedValue({ items: [], total: 0 } as never)
    renderCard(base({
      state: 'auto_filed', proposed_route: 'employee_doc',
      proposed_employee_id: 'G5', proposed_employee_name_en: 'Sara Omar',
    }))
    fireEvent.click(screen.getByText('scanInbox.reMatch'))
    await waitFor(() => expect(undo).toHaveBeenCalledWith(1))
    await screen.findByPlaceholderText('scanInbox.match.searchPlaceholder')
  })
})
