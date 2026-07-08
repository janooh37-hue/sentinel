import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { TopProgressBar } from '../TopProgressBar'
import * as gr from '../../../lib/globalRefresh'

describe('TopProgressBar', () => {
  it('is hidden when not refreshing', () => {
    vi.spyOn(gr, 'useIsRefreshing').mockReturnValue(false)
    const { container } = render(<TopProgressBar />)
    expect(container.querySelector('[data-refreshing="true"]')).toBeNull()
  })
  it('shows the bar while refreshing', () => {
    vi.spyOn(gr, 'useIsRefreshing').mockReturnValue(true)
    const { container } = render(<TopProgressBar />)
    expect(container.querySelector('[data-refreshing="true"]')).not.toBeNull()
  })
})
