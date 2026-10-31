import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'
import { StoreQueryState } from './StoreQueryState'

vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => false }))

describe('Store query loading announcement', () => {
  it.each(['en', 'ar'])('exposes localized loading text in a status region (%s)', async (language) => {
    await i18n.changeLanguage(language)
    render(<StoreQueryState isPending error={null} onRetry={vi.fn()} isEmpty={false} emptyMessage="" emptyDescription=""><p>Loaded records</p></StoreQueryState>)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(i18n.t('assets.store.state.loading'))
    expect(status).not.toHaveAttribute('aria-label')
    expect(status.querySelector('.sr-only')).toHaveTextContent(i18n.t('assets.store.state.loading'))
    expect(screen.queryByText('Loaded records')).not.toBeInTheDocument()
  })
})
