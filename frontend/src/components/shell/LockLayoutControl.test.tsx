import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'

import { LockLayoutControl } from './LockLayoutControl'

describe('LockLayoutControl', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('marks the current layout as pressed among the three options', () => {
    render(<LockLayoutControl value="band" onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Command band' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Central stack' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'Briefing console' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByText('Command band')).toBeInTheDocument()
  })

  it('reports the chosen layout on click', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<LockLayoutControl value="band" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Briefing console' }))

    expect(onChange).toHaveBeenCalledWith('console')
  })

  it('normalizes an unrecognized value to the command band', () => {
    render(<LockLayoutControl value="garbage" onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Command band' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('Command band')).toBeInTheDocument()
  })

  it('disables every option while the preference is saving', () => {
    render(<LockLayoutControl value="stack" onChange={vi.fn()} disabled />)

    expect(screen.getByRole('button', { name: 'Command band' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Central stack' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Briefing console' })).toBeDisabled()
  })
})
