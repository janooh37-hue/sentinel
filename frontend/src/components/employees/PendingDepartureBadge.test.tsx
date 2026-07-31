/**
 * The badge reuses the canonical status translations rather than inventing
 * wording — the Arabic assertions below are the guard against an English leak.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { I18nextProvider } from 'react-i18next'

import i18n from '@/lib/i18n'
import { PendingDepartureBadge } from './PendingDepartureBadge'

function renderBadge(props: Parameters<typeof PendingDepartureBadge>[0], lng = 'en') {
  void i18n.changeLanguage(lng)
  return render(
    <I18nextProvider i18n={i18n}>
      <PendingDepartureBadge {...props} />
    </I18nextProvider>,
  )
}

describe('PendingDepartureBadge', () => {
  it('renders nothing without a pending status', () => {
    const { container } = renderBadge({
      status: 'Active',
      pendingStatus: null,
      endDate: '2026-08-15',
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing without an end date', () => {
    const { container } = renderBadge({
      status: 'Active',
      pendingStatus: 'Resigned',
      endDate: null,
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the employee is not Active, even with a stale pending marker', () => {
    const { container } = renderBadge({
      status: 'Terminated',
      pendingStatus: 'Resigned',
      endDate: '2026-08-15',
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the English status and date', () => {
    renderBadge({ status: 'Active', pendingStatus: 'Resigned', endDate: '2026-08-15' })
    expect(screen.getByText(/Resigned/)).toBeInTheDocument()
    expect(screen.getByText(/15\/08\/2026/)).toBeInTheDocument()
  })

  it('shows the canonical Arabic status for Resigned', () => {
    renderBadge(
      { status: 'Active', pendingStatus: 'Resigned', endDate: '2026-08-15' },
      'ar',
    )
    expect(screen.getByText(/مستقيل/)).toBeInTheDocument()
    expect(screen.queryByText(/Resigned/)).not.toBeInTheDocument()
  })

  it('shows the canonical Arabic status for Terminated', () => {
    renderBadge(
      { status: 'Active', pendingStatus: 'Terminated', endDate: '2026-08-15' },
      'ar',
    )
    expect(screen.getByText(/مفصول/)).toBeInTheDocument()
    expect(screen.queryByText(/Terminated/)).not.toBeInTheDocument()
  })
})
