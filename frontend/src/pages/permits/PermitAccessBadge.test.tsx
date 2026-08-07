import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { PermitAccessAreas, PermitZone } from '@/lib/api'
import { PermitAccessBadge } from './PermitAccessBadge'

const canonicalAccess: PermitAccessAreas = {
  al_wathba_1: ['green'],
  al_wathba_2: ['red'],
  work_residence: true,
}

const canonicalZones: PermitZone[] = ['green', 'red', 'work_residence']

describe('PermitAccessBadge', () => {
  it('renders exact pairings in stable order', () => {
    render(<PermitAccessBadge accessAreas={canonicalAccess} zones={canonicalZones} />)

    expect(screen.getByText(/W1 · Green/i)).toBeInTheDocument()
    expect(screen.getByText(/W2 · Red/i)).toBeInTheDocument()
    expect(screen.getByText(/Work res/i)).toBeInTheDocument()
  })

  it('labels legacy zones without inventing a location', () => {
    render(<PermitAccessBadge accessAreas={null} zones={['green', 'work_residence']} full />)

    expect(screen.getByText(/Location not specified · Green/i)).toBeInTheDocument()
    expect(screen.getByText(/Work residence/i)).toBeInTheDocument()
  })
})
