import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PullToRefresh } from '../PullToRefresh'

function renderWrapped() {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <PullToRefresh>
        <div style={{ height: 2000 }}>content</div>
      </PullToRefresh>
    </QueryClientProvider>,
  )
}

describe('PullToRefresh', () => {
  it('renders its children', () => {
    renderWrapped()
    expect(screen.getByText('content')).toBeInTheDocument()
  })
  it('exposes a scroll container with overscroll containment', () => {
    const { container } = renderWrapped()
    const scroller = container.querySelector('[data-ptr-scroller]') as HTMLElement
    expect(scroller).not.toBeNull()
    expect(scroller.className).toMatch(/overscroll-y-contain/)
  })
})
