/**
 * SignerSignaturePreview — TDD tests.
 *
 * Harness mirrors EmployeePickerField.test.tsx: vi.mock('@/lib/api'),
 * QueryClientProvider + FormProvider wrapper.
 * i18n rule: the no-sig test MUST assert Arabic under lng=ar.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useForm, FormProvider } from 'react-hook-form'
import i18n from 'i18next'

import ar from '@/locales/ar.json'

vi.mock('@/lib/api', () => ({
  api: {
    getEmployeeSignature: vi.fn(),
  },
}))

import { SignerSignaturePreview } from './SignerSignaturePreview'
import { api } from '@/lib/api'

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function Host({ signerId }: { signerId?: string }) {
  const methods = useForm({ defaultValues: { signer_id: signerId ?? '' } })
  return (
    <QueryClientProvider client={makeClient()}>
      <FormProvider {...methods}>
        <SignerSignaturePreview />
      </FormProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SignerSignaturePreview — signer with signature', () => {
  it('shows signature image when signer has a saved signature', async () => {
    vi.mocked(api.getEmployeeSignature).mockResolvedValue({
      dataUrl: 'data:image/png;base64,abc123',
      updatedAt: '2026-01-01T00:00:00Z',
    } as never)

    render(<Host signerId="G1234" />)

    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument())
    expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,abc123')
  })
})

describe('SignerSignaturePreview — no saved signature (Arabic)', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('shows Arabic no-signature warning when signer has no saved signature', async () => {
    vi.mocked(api.getEmployeeSignature).mockResolvedValue(null as never)

    render(<Host signerId="G9999" />)

    await waitFor(() =>
      expect(
        screen.getByText('لا يوجد توقيع محفوظ لهذا الموقّع — سيُنشأ التقرير دون توقيع'),
      ).toBeInTheDocument(),
    )
  })
})

describe('SignerSignaturePreview — no signer selected', () => {
  it('renders nothing when no signer is selected', () => {
    render(<Host />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByText(/توقيع|signature/i)).toBeNull()
  })
})

describe('SignerSignaturePreview — API error', () => {
  it('renders nothing on a transient API error (not the amber warning)', async () => {
    vi.mocked(api.getEmployeeSignature).mockRejectedValue(new Error('network error'))

    const { container } = render(<Host signerId="G5555" />)

    // Wait for the query to settle (error state)
    await waitFor(() => expect(api.getEmployeeSignature).toHaveBeenCalled())
    // Component must be empty — not the false "no signature" amber warning
    expect(container).toBeEmptyDOMElement()
  })
})
