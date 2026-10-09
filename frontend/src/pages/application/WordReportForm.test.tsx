import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getSavedSignature: vi.fn(),
  createWordBook: vi.fn(),
  uploadMySignature: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api,
  ApiError: class ApiError extends Error {
    code: string
    constructor(code: string) { super(code); this.code = code }
  },
  apiErrorMessage: String,
}))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('@/components/signature/SignatureDrawPanel', () => ({
  SignatureDrawPanel: ({ onUse }: { onUse: (dataUrl: string) => void }) => (
    <button type="button" onClick={() => onUse('data:image/png;base64,AA==')}>Use signature</button>
  ),
}))
vi.mock('@/pages/books/WordHandoffDialog', () => ({
  WordHandoffDialog: () => null,
}))

import { WordReportForm } from './InmateReporterApplication'
import type { SessionUser } from '@/lib/api'

const user = {
  id: 7,
  email: 'reporter@example.test',
  name_en: 'Reporter',
  employee_id: 'G123',
  role: 'inmate_reporter',
} as SessionUser

function renderForm(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <WordReportForm user={user} onBack={() => undefined} />
    </QueryClientProvider>,
  )
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Incident report' } })
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-28' } })
}

describe('Word report signature gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.createWordBook.mockResolvedValue({ book_id: 12, token: 'tok', ref_number: 'REPORT-1', filename: 'report.docx', word_url: 'ms-word:test', dav_url: 'dav:' })
    api.uploadMySignature.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => new Blob(['sig'], { type: 'image/png' }) }))
  })

  it('opens the signing pad and waits to create the session until the signature is saved', async () => {
    api.getSavedSignature.mockResolvedValue(null)
    renderForm()

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Word' }))
    expect(await screen.findByRole('heading', { name: 'Save your signature to continue.' })).toBeTruthy()
    expect(api.createWordBook).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Use signature' }))
    await waitFor(() => expect(api.uploadMySignature).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.createWordBook).toHaveBeenCalledTimes(1))
  })

  it('creates the session without showing the pad when a signature exists', async () => {
    api.getSavedSignature.mockResolvedValue('data:image/png;base64,AA==')
    renderForm()

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Word' }))
    await waitFor(() => expect(api.createWordBook).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('heading', { name: 'Save your signature to continue.' })).toBeNull()
    expect(api.uploadMySignature).not.toHaveBeenCalled()
  })
})
