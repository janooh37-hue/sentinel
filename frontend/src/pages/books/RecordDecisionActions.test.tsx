/**
 * Mobile record decision actions. Assert labels in both supported languages so
 * the extracted action surface cannot silently regress to English-only copy.
 */
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'

import ar from '@/locales/ar.json'
import { RecordDecisionActions } from './RecordDecisionActions'

function renderActions({
  busy = false,
  onReturn = vi.fn(),
  onReject = vi.fn(),
  onSign = vi.fn(),
  returnButtonRef,
  rejectButtonRef,
  signButtonRef,
}: Partial<React.ComponentProps<typeof RecordDecisionActions>> = {}) {
  render(
    <RecordDecisionActions
      busy={busy}
      onReturn={onReturn}
      onReject={onReject}
      onSign={onSign}
      returnButtonRef={returnButtonRef}
      rejectButtonRef={rejectButtonRef}
      signButtonRef={signButtonRef}
    />,
  )
  return { onReturn, onReject, onSign }
}

describe('RecordDecisionActions (English)', () => {
  it('renders Return, Reject, and Sign & approve actions', () => {
    renderActions()

    expect(screen.getByRole('button', { name: 'Return' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign & approve' })).toBeInTheDocument()
  })

  it('calls the matching callback once for each action', async () => {
    const user = userEvent.setup()
    const callbacks = renderActions()

    await user.click(screen.getByRole('button', { name: 'Return' }))
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    await user.click(screen.getByRole('button', { name: 'Sign & approve' }))

    expect(callbacks.onReturn).toHaveBeenCalledTimes(1)
    expect(callbacks.onReject).toHaveBeenCalledTimes(1)
    expect(callbacks.onSign).toHaveBeenCalledTimes(1)
  })

  it('disables all actions while a decision is pending', () => {
    renderActions({ busy: true })

    expect(screen.getByRole('button', { name: 'Return' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sign & approve' })).toBeDisabled()
  })

  it('exposes focusable refs for each action button', () => {
    const returnButtonRef = createRef<HTMLButtonElement>()
    const rejectButtonRef = createRef<HTMLButtonElement>()
    const signButtonRef = createRef<HTMLButtonElement>()
    renderActions({ returnButtonRef, rejectButtonRef, signButtonRef })

    returnButtonRef.current?.focus()
    expect(screen.getByRole('button', { name: 'Return' })).toHaveFocus()

    rejectButtonRef.current?.focus()
    expect(screen.getByRole('button', { name: 'Reject' })).toHaveFocus()

    signButtonRef.current?.focus()
    expect(screen.getByRole('button', { name: 'Sign & approve' })).toHaveFocus()
  })
})

describe('RecordDecisionActions (Arabic)', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })

  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders all three Arabic action labels', () => {
    renderActions()

    expect(screen.getByRole('button', { name: 'إعادة' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'رفض' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'التوقيع والموافقة' })).toBeInTheDocument()
  })
})
