import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'

import { LockTimerControl } from './LockTimerControl'

describe('LockTimerControl', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('steps through only the approved timer values', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<LockTimerControl value={300} onChange={onChange} />)

    expect(screen.getByRole('status')).toHaveTextContent('5 min')

    await user.click(screen.getByRole('button', { name: 'Shorter lock timer' }))
    await user.click(screen.getByRole('button', { name: 'Longer lock timer' }))

    expect(onChange).toHaveBeenNthCalledWith(1, 120)
    expect(onChange).toHaveBeenNthCalledWith(2, 900)
  })

  it('disables the unavailable direction at each policy boundary', () => {
    const { rerender } = render(<LockTimerControl value={30} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Shorter lock timer' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Longer lock timer' })).toBeEnabled()

    rerender(<LockTimerControl value={1800} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Shorter lock timer' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Longer lock timer' })).toBeDisabled()
  })

  it('disables both controls while the preference is saving', () => {
    render(<LockTimerControl value={300} onChange={vi.fn()} disabled />)

    expect(screen.getByRole('button', { name: 'Shorter lock timer' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Longer lock timer' })).toBeDisabled()
  })

  it('uses Western digits in Arabic like the rest of the app', async () => {
    await i18n.changeLanguage('ar')
    render(<LockTimerControl value={300} onChange={vi.fn()} />)

    expect(screen.getByRole('status')).toHaveTextContent('5 د')
    expect(screen.getByRole('status')).not.toHaveTextContent('٥')
  })
})
