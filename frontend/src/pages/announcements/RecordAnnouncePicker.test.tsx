// frontend/src/pages/announcements/RecordAnnouncePicker.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))
// Mocked so pdf.js never loads in jsdom; the picker lazy-imports this module.
vi.mock('../application/DocPdfCanvas', () => ({
  default: ({ pdfUrl }: { pdfUrl: string }) => <div data-testid="doc-preview">{pdfUrl}</div>,
}))
vi.mock('../../lib/api', () => ({
  api: {
    listBooks: vi.fn(),
    documentDownloadUrl: (id: number, fmt: string) => `/api/v1/documents/${id}/download?format=${fmt}`,
  },
}))

import { api, type BookRead } from '../../lib/api'
import { RecordAnnouncePicker, type PickedBook } from './RecordAnnouncePicker'

const withDoc = {
  id: 5, ref_number: 'GS-0005', subject: 'Leave request', versions: [{ version_no: 1, document_id: 90 }],
} as unknown as BookRead
const noDoc = {
  id: 6, ref_number: 'GS-0006', subject: 'No file', versions: [],
} as unknown as BookRead

function renderPicker(onPick: (b: PickedBook) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <RecordAnnouncePicker open onClose={() => {}} onPick={onPick} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.listBooks).mockResolvedValue({ items: [withDoc, noDoc], total: 2, limit: 20, offset: 0 })
})

describe('RecordAnnouncePicker', () => {
  it('lists search results', async () => {
    renderPicker(() => {})
    expect(await screen.findByText('GS-0005')).toBeInTheDocument()
    expect(screen.getByText('GS-0006')).toBeInTheDocument()
  })

  it('previews the selected record and confirms the pick', async () => {
    const onPick = vi.fn()
    renderPicker(onPick)
    await userEvent.click(await screen.findByText('GS-0005'))
    // preview renders the doc PDF url
    expect(await screen.findByTestId('doc-preview')).toHaveTextContent('/documents/90/download?format=pdf')
    await userEvent.click(screen.getByRole('button', { name: 'sendToGroup.picker.confirm' }))
    expect(onPick).toHaveBeenCalledWith({ id: 5, ref: 'GS-0005', subject: 'Leave request' })
  })

  it('disables confirm for a record with no attachable document', async () => {
    renderPicker(() => {})
    await userEvent.click(await screen.findByText('GS-0006'))
    expect(await screen.findByText('sendToGroup.picker.noDocument')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'sendToGroup.picker.confirm' })).toBeDisabled()
  })
})
