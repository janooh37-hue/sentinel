import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import i18n from 'i18next'

import ar from '@/locales/ar.json'
import { api, type BookRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIsMobile } from '@/lib/useIsMobile'
import { SavedRecordActions } from './SavedRecordActions'

vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: vi.fn() }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: vi.fn() }))
vi.mock('./SubmitForApprovalDialog', () => ({
  SubmitForApprovalDialog: ({ bookId }: { bookId: number }) => (
    <div data-testid="approval-dialog">dialog:{bookId}</div>
  ),
}))

const mockUseCapabilities = vi.mocked(useCapabilities)
const mockUseIsMobile = vi.mocked(useIsMobile)

function makeBook(overrides: Partial<BookRead> = {}): BookRead {
  return {
    id: 42,
    ref_number: 'REF-42',
    approval_state: 'none',
    versions: [{ pdf_url: '/current.pdf' }],
    ...overrides,
  } as BookRead
}

function renderActions(props: Partial<React.ComponentProps<typeof SavedRecordActions>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/completion']}>
        <SavedRecordActions bookId={42} refNumber="REF-42" {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

function renderWithLocation() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/completion']}>
        <SavedRecordActions bookId={42} refNumber="REF-42" />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  await i18n.addResourceBundle('ar', 'translation', ar, true, true)
  await i18n.changeLanguage('ar')
  mockUseCapabilities.mockReturnValue({ capabilities: new Set(['books.manage']), isLoading: false, has: () => true })
  vi.spyOn(api, 'getBook').mockResolvedValue(makeBook())
  mockUseIsMobile.mockReturnValue(false)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  void i18n.changeLanguage('en')
})
describe('SavedRecordActions', () => {
  it('shows Arabic saved/reference copy and desktop Print, approval, and full-record actions', async () => {
    renderActions({ detail: 'Generated from Word' })

    expect(await screen.findByText('تم الحفظ في السجلات')).toBeVisible()
    expect(screen.getByText('المرجع REF-42')).toBeVisible()
    expect(screen.getByText('Generated from Word')).toBeVisible()
    await waitFor(() => expect(screen.getByRole('button', { name: 'طباعة' })).toBeEnabled())
    expect(screen.getByRole('button', { name: 'طباعة' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'إرسال للموافقة' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'فتح السجل الكامل' })).toBeVisible()
  })
 
  it('places approval, Print, and open actions in mobile DOM order', async () => {
    mockUseIsMobile.mockReturnValue(true)
    renderActions()

    await waitFor(() => expect(screen.getByRole('button', { name: 'طباعة' })).toBeEnabled())
    expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'إرسال للموافقة',
      'طباعة',
      'فتح السجل الكامل',
    ])
  })

  it('opens the existing approval dialog with the same book id', async () => {
    renderActions()
    await userEvent.click(await screen.findByRole('button', { name: 'إرسال للموافقة' }))
    expect(screen.getByTestId('approval-dialog')).toHaveTextContent('dialog:42')
  })

  it('shows pending status without a send action', async () => {
    vi.mocked(api.getBook).mockResolvedValue(makeBook({ approval_state: 'pending' }))
    renderActions()

    expect(await screen.findByText('بانتظار الاعتماد')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'إرسال للموافقة' })).not.toBeInTheDocument()
  })

  it('hides approval action without books.manage', async () => {
    mockUseCapabilities.mockReturnValue({ capabilities: new Set(), isLoading: false, has: () => false })
    vi.mocked(api.getBook).mockResolvedValue(makeBook({ approval_state: 'pending' }))
    renderActions()

    await screen.findByText('تم الحفظ في السجلات')
    expect(screen.queryByRole('button', { name: 'إرسال للموافقة' })).not.toBeInTheDocument()
  })

  it('disables Print and explains when no current or imported PDF exists', async () => {
    vi.mocked(api.getBook).mockResolvedValue(
      makeBook({ versions: [{ pdf_url: null } as BookRead['versions'][number]] }),
    )
    renderActions()

    expect(await screen.findByRole('button', { name: 'طباعة' })).toBeDisabled()
    expect(await screen.findByText('ملف PDF غير متاح — افتح السجل لاستخدام ملف DOCX البديل.')).toBeVisible()
  })

  it('opens print in a new tab and clears the opener', async () => {
    const opened = { opener: window } as unknown as Window
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(opened)
    vi.mocked(api.getBook).mockResolvedValue(makeBook())
    renderActions()

    await waitFor(() => expect(screen.getByRole('button', { name: 'طباعة' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'طباعة' }))
    expect(openSpy).toHaveBeenCalledWith('/books/42?print=1', '_blank')
    expect(opened.opener).toBeNull()
  })

  it('falls back to in-app print navigation when the popup is blocked', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    renderWithLocation()

    await userEvent.click(await screen.findByRole('button', { name: 'طباعة' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/books/42?print=1'))
  })

  it('summarizes enabled and skipped notifications honestly and omits absent notification state', async () => {
    const { unmount } = renderActions({ notification: 'enabled' })
    expect(await screen.findByText('تم الحفظ مع تفعيل إشعار الموظف.')).toBeVisible()
    unmount()

    renderActions({ notification: 'skipped' })
    expect(await screen.findByText('تم الحفظ دون إشعار الموظف.')).toBeVisible()
    expect(screen.queryByText('تم الحفظ مع تفعيل إشعار الموظف.')).not.toBeInTheDocument()

    cleanup()
    renderActions()
    await screen.findByText('تم الحفظ في السجلات')
    expect(screen.queryByText('تم الحفظ مع تفعيل إشعار الموظف.')).not.toBeInTheDocument()
    expect(screen.queryByText('تم الحفظ دون إشعار الموظف.')).not.toBeInTheDocument()
  })
})
