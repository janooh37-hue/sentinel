import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { PermitDetailDialog } from './PermitDetailDialog'

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set(['permits.manage']), isLoading: false, has: () => true }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const basePermit = {
  id: 99,
  permit_no: 'PMT-0099',
  company: 'Test Corp',
  zones: ['green'] as const,
  start_date: '2026-07-01',
  end_date: '2026-12-31',
  status: 'active' as const,
  created_at: '2026-07-01T00:00:00',
  derived_status: 'active' as const,
  duration_days: 183,
  days_remaining: 90,
  people_count: 1,
  vehicle_count: 1,
  has_document: false,
  purpose: null,
  notes: null,
  revoked_at: null,
  revoke_reason: null,
  updated_at: null,
  document_name: null,
  people: [],
  vehicles: [],
  manager_id: null,
}

vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...mod,
    api: {
      ...mod.api,
      getPermit: vi.fn(),
      getBook: vi.fn(),
    },
  }
})

function renderDetail(permitOverrides: object = {}) {
  vi.spyOn(api, 'getPermit').mockResolvedValue({ ...basePermit, ...permitOverrides } as never)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <PermitDetailDialog permitId={99} open onOpenChange={vi.fn()} onEdit={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('PermitDetailDialog', () => {
  it('shows 1/5 book ref and vehicle colour when present', async () => {
    renderDetail({
      book_ref: '1/5/GSSG/0042',
      book_id: 7,
      vehicles: [
        {
          id: 1,
          permit_id: 99,
          plate_no: 'A 1',
          plate_emirate: null,
          make_model: null,
          driver_name: null,
          licence_doc_name: null,
          created_at: '2026-07-01T00:00:00',
          removed_at: null,
          colour: 'White',
          reg_expiry: '2027-03-14',
        },
      ],
    })

    await waitFor(() => expect(screen.getByText('1/5/GSSG/0042')).toBeInTheDocument())
    expect(screen.getByText('White')).toBeInTheDocument()
    // Print button present when book_id is set
    expect(screen.getByRole('button', { name: /print permit/i })).toBeInTheDocument()
  })

  it('hides Print button when book_id is absent', async () => {
    renderDetail({ book_id: null, book_ref: null })
    await waitFor(() => expect(screen.getByText('Test Corp')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /print permit/i })).not.toBeInTheDocument()
  })

  it('calls getBook on Print click and opens the PDF URL', async () => {
    vi.spyOn(api, 'getBook').mockResolvedValue({
      id: 7,
      versions: [
        {
          id: 1,
          version_no: 1,
          pdf_url: '/api/v1/documents/42/download?format=pdf',
          manager_sig_embedded: false,
          status: 'none',
        },
      ],
    } as never)

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    renderDetail({ book_id: 7, book_ref: '1/5/GSSG/0042' })
    await waitFor(() => expect(screen.getByText('1/5/GSSG/0042')).toBeInTheDocument())

    screen.getByRole('button', { name: /print permit/i }).click()

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(
      '/api/v1/documents/42/download?format=pdf',
      '_blank',
      'noopener',
    ))

    openSpy.mockRestore()
  })
})
