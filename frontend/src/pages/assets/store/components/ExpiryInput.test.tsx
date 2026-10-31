import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as ReactI18next from 'react-i18next'

import type { ExpiryValue } from '../storeUtils'
import { ExpiryInput } from './ExpiryInput'

vi.mock('react-i18next', async (importOriginal) => {
  const original = await importOriginal<typeof ReactI18next>()
  return { ...original, useTranslation: () => ({ t: (key: string) => key }) }
})

const initial: ExpiryValue = { mode: 'date', date: '2027-01-20', month: '2027-03' }

function Editor({ dir = 'ltr', allowUndated = true, disabled = false }: {
  dir?: 'ltr' | 'rtl'
  allowUndated?: boolean
  disabled?: boolean
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  return <div dir={dir}>
    <ExpiryInput id="expiry" value={value} onChange={setValue} allowUndated={allowUndated} disabled={disabled} invalid describedBy="expiry-error" />
    <p id="expiry-error">Invalid expiry</p>
    <button type="button">After expiry</button>
  </div>
}

afterEach(cleanup)

describe('ExpiryInput', () => {
  it('has native radios with one tab stop and moves focus and selection with arrows', async () => {
    const user = userEvent.setup()
    render(<Editor />)
    const [date, month, none] = screen.getAllByRole('radio')
    expect(date).toHaveAttribute('type', 'radio')
    expect(screen.getAllByRole('radio').filter((radio) => radio.tabIndex === 0)).toEqual([date])
    await user.tab()
    expect(date).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(month).toHaveFocus()
    expect(month).toBeChecked()
    expect(date).not.toBeChecked()
    expect(screen.getByLabelText('assets.store.expiryInput.monthAria')).toHaveValue('2027-03')
    await user.keyboard('{ArrowDown}')
    expect(none).toHaveFocus()
    expect(none).toBeChecked()
    await user.tab()
    expect(screen.getByRole('button', { name: 'After expiry' })).toHaveFocus()
  })

  it('wraps arrows within the two allowed modes without introducing no-expiry', async () => {
    const user = userEvent.setup()
    render(<Editor allowUndated={false} />)
    const [date, month] = screen.getAllByRole('radio')
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    date.focus()
    await user.keyboard('{ArrowLeft}')
    expect(month).toHaveFocus()
    expect(month).toBeChecked()
    await user.keyboard('{ArrowRight}')
    expect(date).toHaveFocus()
    expect(date).toBeChecked()
    expect(screen.getByLabelText('assets.store.expiryInput.dateAria')).toHaveValue('2027-01-20')
  })

  it('mirrors horizontal arrows in RTL while retaining vertical ordering', async () => {
    const user = userEvent.setup()
    render(<Editor dir="rtl" />)
    const [date, month, none] = screen.getAllByRole('radio')
    date.focus()
    await user.keyboard('{ArrowLeft}')
    expect(month).toHaveFocus()
    expect(month).toBeChecked()
    await user.keyboard('{ArrowRight}')
    expect(date).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(none).toHaveFocus()
    expect(none).toBeChecked()
  })

  it('selects by pointer and retains linked validation for the active input', async () => {
    const user = userEvent.setup()
    render(<Editor />)
    await user.click(screen.getByRole('radio', { name: 'assets.store.expiryInput.month' }))
    const month = screen.getByLabelText('assets.store.expiryInput.monthAria')
    expect(month).toHaveAttribute('aria-invalid', 'true')
    expect(month).toHaveAccessibleDescription('Invalid expiry')
    await user.clear(month)
    await user.type(month, '2028-05')
    expect(month).toHaveValue('2028-05')
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.closest('label')).toHaveClass('min-h-11')
      expect(radio.nextElementSibling).toHaveClass('peer-focus-visible:ring-2')
    }
  })

  it('disables all mode and date controls', async () => {
    const user = userEvent.setup()
    render(<Editor disabled />)
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(screen.getByLabelText('assets.store.expiryInput.dateAria')).toBeDisabled()
    await user.tab()
    expect(screen.getByRole('button', { name: 'After expiry' })).toHaveFocus()
  })
})
