import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const capabilityState = vi.hoisted(() => ({ allowed: new Set<string>() }))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: capabilityState.allowed,
    isLoading: false,
    has: (capability: string) => capabilityState.allowed.has(capability),
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { FormRail, type RailItem } from './FormRail'

const items: RailItem[] = [
  { serviceId: 'all', glyph: '•', label: 'All', count: 10, states: [] },
  { serviceId: 'General Book', glyph: 'G', label: 'General Book', count: 7, states: [] },
  { serviceId: 'Report', glyph: 'R', label: 'Report', count: 3, states: [] },
]

describe('FormRail service permissions', () => {
  beforeEach(() => {
    capabilityState.allowed = new Set([
      'books.servicerecords.General Book',
      'books.service.Report',
    ])
  })

  it('shows a records-visible service and hides a creation-only service', () => {
    render(<FormRail items={items} active="all" onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: /All/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /General Book/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Report/ })).not.toBeInTheDocument()
  })
})
