import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { RefreshRing } from '../RefreshRing'

describe('RefreshRing', () => {
  it('renders a progress arc while pulling', () => {
    const { container } = render(<RefreshRing stage="pulling" progress={0.5} />)
    expect(container.querySelector('[data-part="arc"]')).not.toBeNull()
  })
  it('shows the checkmark when done', () => {
    const { container } = render(<RefreshRing stage="done" progress={1} />)
    expect(container.querySelector('[data-part="check"]')).not.toBeNull()
  })
})
