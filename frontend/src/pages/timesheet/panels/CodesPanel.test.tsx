import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CodesPanel } from './CodesPanel'

const index = {
  cellCounts: { P: 1, AL: 2, SL: 0, AB: 0, TR: 0, NG: 0, '-': 0, X: 0 },
  employeeIds: { P: ['G7014'], AL: ['G7014'], SL: [], AB: [], TR: [], NG: [], '-': [], X: [] },
}

describe('CodesPanel', () => {
  it('activates a matching code and disables zero-match codes', async () => {
    const onFilterCode = vi.fn()
    render(<CodesPanel index={index} onFilterCode={onFilterCode} />)

    const annualLeave = screen.getByRole('button', { name: /annual leave/i })
    await userEvent.click(annualLeave)
    expect(onFilterCode).toHaveBeenCalledWith('AL')
    expect(screen.getByTestId('code-badge-AL')).toHaveAttribute('data-code', 'AL')
    expect(screen.getByRole('button', { name: /sick leave/i })).toBeDisabled()
  })
})
