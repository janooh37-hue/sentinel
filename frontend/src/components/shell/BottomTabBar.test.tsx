import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

function openTools(): void {
  fireEvent.click(screen.getByRole('button', { name: 'More' }))
}

function enterEditMode(slotLabel: string): void {
  openTools()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Edit dock' }))
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Menu' })).getByRole('button', { name: slotLabel }))
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
})

describe('BottomTabBar', () => {
  it('renders the four default tabs and the More button', () => {
    renderDock()

    const navigation = screen.getByRole('navigation', { name: 'Menu' })
    for (const label of ['Dashboard', 'Employees', 'Services', 'Records']) {
      expect(within(navigation).getByRole('link', { name: label })).toBeInTheDocument()
    }
    expect(within(navigation).getByRole('button', { name: 'More' })).toBeInTheDocument()
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
    expect(within(navigation).getByRole('button', { name: 'More' })).toBeInTheDocument()
    for (const denied of ['Employees', 'Services', 'Records']) {
      expect(within(navigation).queryByRole('link', { name: denied })).not.toBeInTheDocument()
    }
  })

  it('omits denied waiting signals from the customization picker', () => {
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
    localStorage.setItem(
      NAV_SLOTS_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        ids: ['sec:/', 'sec:/employees', 'sig:approvals', 'sec:/books'],
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
    expect(stored.ids[1]).toBe('sec:/employees')
    expect(stored.ids[2]).toBe('sig:scanback')
  })

  it('opens the tools sheet on More without navigating', () => {
    renderDock()

    openTools()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })

  it('navigates to a tapped entry and closes the sheet', () => {
    renderDock()

    openTools()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Records' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/books')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('holding a dock link has no touch callout', () => {
    renderDock()

    expect(screen.getByRole('link', { name: 'Employees' })).toHaveClass('[-webkit-touch-callout:none]')
  })

  it('places a waiting signal into the held slot and shows its live badge', () => {
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
    renderDock()

    enterEditMode('Employees')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
