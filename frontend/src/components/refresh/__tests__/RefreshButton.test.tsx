import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RefreshButton } from '../RefreshButton'

describe('RefreshButton', () => {
  it('calls refreshAll on click', () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    render(
      <QueryClientProvider client={qc}>
        <RefreshButton />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /refresh|تحديث/i }))
    expect(spy).toHaveBeenCalledWith({ refetchType: 'active' })
  })
})
