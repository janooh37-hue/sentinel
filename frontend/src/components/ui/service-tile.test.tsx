import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ServiceTile } from './service-tile'

const baseProps = {
  emoji: '💰',
  title: 'Salary transfer',
  description: 'Transfer salary to a bank account',
  onClick: vi.fn(),
}

describe('ServiceTile artwork', () => {
  it('renders calibrated artwork and its semantic motion instead of the emoji', () => {
    const { container } = render(<ServiceTile {...baseProps} artwork="salary-transfer" />)

    expect(container.querySelector('img')?.getAttribute('src')).toContain(
      'salary-transfer.webp',
    )
    expect(container.querySelector('[data-service-motion="deposit"]')).not.toBeNull()
    expect(screen.queryByText('💰')).not.toBeInTheDocument()
  })

  it('retains the emoji fallback for services without calibrated artwork', () => {
    const { container } = render(<ServiceTile {...baseProps} />)

    expect(screen.getByText('💰')).toBeInTheDocument()
    expect(container.querySelector('img')).not.toBeInTheDocument()
  })
})
