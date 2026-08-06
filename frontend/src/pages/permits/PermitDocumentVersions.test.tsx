import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'

import { PermitDocumentVersions } from './PermitDocumentVersions'
import { api } from '@/lib/api'

const hasCapability = vi.hoisted(() => vi.fn(() => true))
const mobileState = vi.hoisted(() => ({ value: false }))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set(['books.manage']), isLoading: false, has: hasCapability }),
}))
vi.mock('@/lib/useIsMobile', () => ({
  useIsMobile: () => mobileState.value,
}))

const versions = [
  {
    id: 1,
    version_no: 1,
    trigger: 'initial',
    status: 'none',
    fields: {},
    document_id: 11,
    docx_url: '/v1.docx',
    pdf_url: '/v1.pdf',
    signed_pdf_url: null,
    manager_sig_embedded: false,
  },
  {
    id: 2,
    version_no: 2,
    trigger: 'revision',
    status: 'none',
    fields: { subject: 'updated' },
    document_id: 12,
    docx_url: '/v2.docx',
    pdf_url: '/v2.pdf',
    signed_pdf_url: '/v2-signed.pdf',
    manager_sig_embedded: true,
  },
  {
    id: 3,
    version_no: 3,
    trigger: 'revision',
    status: 'none',
    fields: { subject: 'latest' },
    document_id: 13,
    docx_url: '/v3.docx',
    pdf_url: '/v3.pdf',
    signed_pdf_url: null,
    manager_sig_embedded: false,
  },
]

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  vi.restoreAllMocks()
  mobileState.value = false
  hasCapability.mockReturnValue(true)
  vi.spyOn(api, 'getBook').mockResolvedValue({ id: 9, versions: [versions[1], versions[0], versions[2]] } as never)
})

describe('PermitDocumentVersions', () => {
  it('renders versions newest first', async () => {
    render(<PermitDocumentVersions bookId={9} />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByText('v3')).toBeInTheDocument())
    expect(screen.getAllByText(/^v[123]$/).map((node) => node.textContent)).toEqual(['v3', 'v2', 'v1'])
  })
  it('exposes unsigned DOCX and PDF downloads', async () => {
    render(<PermitDocumentVersions bookId={9} />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByText('v1')).toBeInTheDocument())
    const docxLinks = screen.getAllByRole('link', { name: /docx/i })
    expect(docxLinks[0]).toHaveAttribute('href', '/v3.docx')
    const pdfLinks = screen.getAllByRole('link', { name: /pdf/i })
    expect(pdfLinks[0]).toHaveAttribute('href', '/v3.pdf')
    expect(pdfLinks[0]).toHaveAttribute('target', '_blank')
  })

  it('uses signed PDF exclusively for signed versions', async () => {
    render(<PermitDocumentVersions bookId={9} />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByText('v2')).toBeInTheDocument())
    const row = screen.getByText('v2').closest('li')
    expect(row).not.toBeNull()
    expect(row).not.toHaveTextContent('DOCX')
    expect(row).toHaveTextContent('PDF')
    expect(row?.querySelector('a[href="/v2-signed.pdf"]')).not.toBeNull()
    expect(row?.querySelector('a[href="/v2.pdf"]')).toBeNull()
  })

  it('shows Word actions for books.manage', async () => {
    render(<PermitDocumentVersions bookId={9} />, { wrapper: wrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: /edit in word/i })).toBeInTheDocument())
  })

  it('disables Word editing with the PC hint on mobile', async () => {
    mobileState.value = true
    render(<PermitDocumentVersions bookId={9} />, { wrapper: wrapper() })
    const button = await screen.findByRole('button', { name: /edit in word/i })
    expect(button).toBeDisabled()
    expect(screen.getByText(/needs a pc/i)).toBeInTheDocument()
  })

})
