import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'

import i18n from '@/lib/i18n'
import { useCapabilities } from '@/lib/useCapabilities'

import { BottomTabBar } from './BottomTabBar'
import { NAV_SLOTS_STORAGE_KEY } from './navCustomization'

vi.mock('./useWaitingSignals', () => ({
  useWaitingSignals: () => ({ approvals: 4 }),
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: vi.fn(),
}))

const mockUseCapabilities = vi.mocked(useCapabilities)

function LocationProbe(): React.JSX.Element {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function renderDock(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <BottomTabBar />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function enterEditMode(slotLabel: string): void {
  const slot = screen.getByRole('link', { name: slotLabel })
  fireEvent.pointerDown(slot, { pointerId: 1, clientX: 0, clientY: 0 })
  act(() => vi.advanceTimersByTime(500))
}

beforeEach(async () => {
  localStorage.clear()
  await i18n.changeLanguage('en')
  mockUseCapabilities.mockReturnValue({
    capabilities: new Set(),
    has: () => true,
    isLoading: false,
  })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('BottomTabBar', () => {
  it('renders the five default tabs with translated labels', () => {
    renderDock()

    const navigation = screen.getByRole('navigation', { name: 'Menu' })
    for (const label of ['Dashboard', 'Employees', 'Ledger', 'Services', 'Records']) {
      expect(within(navigation).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('never falls back to a denied default destination', () => {
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(),
      has: () => false,
      isLoading: false,
    })
    renderDock()

    const navigation = screen.getByRole('navigation', { name: 'Menu' })
    expect(within(navigation).getAllByRole('link')).toHaveLength(1)
    expect(within(navigation).getByRole('link', { name: 'Dashboard' })).toBeVisible()
    for (const denied of ['Employees', 'Ledger', 'Services', 'Records']) {
      expect(within(navigation).queryByRole('link', { name: denied })).not.toBeInTheDocument()
    }
  })

  it('omits denied waiting signals from the customization picker', () => {
    vi.useFakeTimers()
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(),
      has: () => false,
      isLoading: false,
    })
    renderDock()

    enterEditMode('Dashboard')
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Approvals' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Scan-back' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Unread' })).not.toBeInTheDocument()
  })

  it('edits the original persisted slot when denied slots compact the rendered dock', () => {
    vi.useFakeTimers()
    localStorage.setItem(
      NAV_SLOTS_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        ids: [
          'sec:/',
          'sec:/employees',
          'sec:/application',
          'sig:approvals',
          'sec:/books',
        ],
      }),
    )
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(['books.view', 'books.approve', 'books.edit']),
      has: (capability) => ['books.view', 'books.approve', 'books.edit'].includes(capability),
      isLoading: false,
    })
    renderDock()

    enterEditMode('Approvals')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Scan-back' }))

    const stored = JSON.parse(localStorage.getItem(NAV_SLOTS_STORAGE_KEY) ?? '')
    expect(stored.ids[2]).toBe('sec:/application')
    expect(stored.ids[3]).toBe('sig:scanback')
  })

  it('opens customization on long-press without navigating', () => {
    vi.useFakeTimers()
    renderDock()

    enterEditMode('Employees')

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })

  it('places a waiting signal into the held slot and shows its live badge', () => {
    vi.useFakeTimers()
    renderDock()

    enterEditMode('Employees')
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approvals' }))

    const stored = JSON.parse(localStorage.getItem(NAV_SLOTS_STORAGE_KEY) ?? '')
    expect(stored.ids[1]).toBe('sig:approvals')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    const navigation = screen.getByRole('navigation', { name: 'Menu' })
    expect(within(navigation).getByText('Approvals')).toBeInTheDocument()
    expect(within(navigation).getByText('4')).toBeInTheDocument()
  })

  it('closes customization when Done is tapped', () => {
    vi.useFakeTimers()
    renderDock()

    enterEditMode('Employees')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
