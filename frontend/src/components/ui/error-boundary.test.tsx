// frontend/src/components/ui/error-boundary.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from './error-boundary'
import { api } from '../../lib/api'

vi.mock('@/lib/i18n', () => ({
  default: { t: (k: string) => k },
}))

function Bomb(): never {
  throw new Error('kaboom from test')
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(api, 'postCrashReport').mockResolvedValue(undefined as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('all good')).toBeInTheDocument()
  })

  it('shows the fallback with the cable scene and diagnostics on a render error', () => {
    const { container } = render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    // headline + error message surfaced
    expect(screen.getByText('errors.generic')).toBeInTheDocument()
    expect(screen.getByText('kaboom from test')).toBeInTheDocument()
    // illustration: disconnected cable halves + spark, and the globe
    expect(container.querySelector('.eb-conn-male')).not.toBeNull()
    expect(container.querySelector('.eb-conn-female')).not.toBeNull()
    expect(container.querySelector('.eb-spark')).not.toBeNull()
    expect(container.querySelector('.eb-globe')).not.toBeNull()
    // action buttons
    expect(screen.getByText('errors.boundary.copyDiagnostic')).toBeInTheDocument()
    expect(screen.getByText('errors.boundary.reload')).toBeInTheDocument()
    // crash report fired
    expect(api.postCrashReport).toHaveBeenCalledOnce()
  })
})
