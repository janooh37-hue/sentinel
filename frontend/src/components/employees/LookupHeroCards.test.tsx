/**
 * LookupHeroCards — tests for the three hero info-cards:
 *   1. Recently-opened employee chips
 *   2. Soon-expiring documents (count badge + top-2 rows)
 *   3. Data-gap summary (completeness badge + localized field labels + CTA)
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: new Set(['expiry.view']),
    isLoading: false,
    has: (capability: string) => capability === 'expiry.view',
  }),
}))

import { LookupHeroCards } from './LookupHeroCards'

// ─── Mock: @/lib/api ─────────────────────────────────────────────────────────
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig()),
  api: {
    getExpiry: vi.fn().mockResolvedValue([
      {
        employee_id: 'G3190',
        name_en: 'ABDULLA ALABRI',
        name_ar: 'عبدالله العبرى',
        doc_type: 'uae_id',
        expiry_date: '2026-09-14',
        days_remaining: 68,
        bucket: 'soon',
      },
      {
        employee_id: 'G3260',
        name_en: 'AHMED ALHARSH',
        name_ar: 'احمد الهرش',
        doc_type: 'passport',
        expiry_date: '2026-08-11',
        days_remaining: 34,
        bucket: 'critical',
      },
      {
        employee_id: 'G3254',
        name_en: 'ADEL ALJAFA',
        name_ar: 'عادل الجفه',
        doc_type: 'uae_id',
        expiry_date: '2026-09-20',
        days_remaining: 74,
        bucket: 'soon',
      },
    ]),
    getEmployeesCompleteness: vi.fn().mockResolvedValue({
      incomplete: 12,
      tracked: 14,
      top_missing: [
        { field: 'nationality', count: 9 },
        { field: 'iban', count: 7 },
      ],
      first_incomplete_id: 'G3190',
    }),
  },
}))

// ─── Mock: @/lib/employeeRecents ─────────────────────────────────────────────
vi.mock('@/lib/employeeRecents', () => ({
  getRecentEmployees: vi.fn().mockReturnValue([
    { id: 'G3190', name_en: 'ABDULLA ALABRI', name_ar: 'عبدالله العبرى', ts: 1_700_000_000 },
    { id: 'G3260', name_en: 'AHMED ALHARSH', name_ar: 'احمد الهرش', ts: 1_699_000_000 },
    { id: 'G3254', name_en: 'ADEL ALJAFA', name_ar: 'عادل الجفه', ts: 1_698_000_000 },
  ]),
}))

// ─── Wrapper ──────────────────────────────────────────────────────────────────
function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('LookupHeroCards', () => {
  it('selects activity without opening the profile from a recent chip', async () => {
    const onSelectRecent = vi.fn()
    const onOpenProfile = vi.fn()
    wrap(<LookupHeroCards onSelectRecent={onSelectRecent} onOpenProfile={onOpenProfile} />)

    // All three recent employees must appear
    expect(screen.getByText('ABDULLA ALABRI')).toBeInTheDocument()
    expect(screen.getByText('AHMED ALHARSH')).toBeInTheDocument()
    expect(screen.getByText('ADEL ALJAFA')).toBeInTheDocument()

    const chip = screen.getByRole('button', { name: /ABDULLA ALABRI/ })
    await userEvent.click(chip)
    expect(onSelectRecent).toHaveBeenCalledWith('G3190')
    expect(onOpenProfile).not.toHaveBeenCalled()
  })

  it('orders the top two expiry rows and opens the selected profile directly', async () => {
    const onSelectRecent = vi.fn()
    const onOpenProfile = vi.fn()
    wrap(<LookupHeroCards onSelectRecent={onSelectRecent} onOpenProfile={onOpenProfile} />)

    // Badge shows total count of expiring items (3 from mock)
    await waitFor(() => {
      expect(screen.getByTestId('expiry-count')).toHaveTextContent('3')
    })

    // Top-2 rows ascending by days_remaining: 34d first, then 68d
    expect(screen.getByText('34 days')).toBeInTheDocument()
    expect(screen.getByText('68 days')).toBeInTheDocument()

    // Third row (74 days) must NOT be shown
    expect(screen.queryByText('74 days')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /AHMED ALHARSH.*Passport/ }))
    expect(onOpenProfile).toHaveBeenCalledWith('G3260')
    expect(onSelectRecent).not.toHaveBeenCalled()
  })

  it('renders localized data gaps and opens the first incomplete profile', async () => {
    const onSelectRecent = vi.fn()
    const onOpenProfile = vi.fn()
    wrap(<LookupHeroCards onSelectRecent={onSelectRecent} onOpenProfile={onOpenProfile} />)

    // Badge shows incomplete count (12 from mock)
    await waitFor(() => {
      expect(screen.getByTestId('gaps-count')).toHaveTextContent('12')
    })

    // Field labels resolved via t('employee.field.*') — must NOT show raw keys
    expect(screen.getByText(/Nationality/)).toBeInTheDocument()
    expect(screen.getByText(/IBAN/)).toBeInTheDocument()
    expect(screen.queryByText(/nationality/)).not.toBeInTheDocument() // raw key
    expect(screen.queryByText(/\biban\b/)).not.toBeInTheDocument()   // raw key

    const cta = screen.getByRole('button', { name: /Start completing files/ })
    await userEvent.click(cta)
    expect(onOpenProfile).toHaveBeenCalledWith('G3190')
    expect(onSelectRecent).not.toHaveBeenCalled()
  })
})
