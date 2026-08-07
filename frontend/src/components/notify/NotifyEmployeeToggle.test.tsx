import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NotifyEmployeeToggle } from './NotifyEmployeeToggle'

describe('NotifyEmployeeToggle', () => {
  it('is disabled without changing state when disabled', () => {
    const onChange = vi.fn()
    render(
      <NotifyEmployeeToggle
        checked
        disabled
        onChange={onChange}
        label="إشعار الموظف"
      />,
    )

    const toggle = screen.getByRole('switch', { name: 'إشعار الموظف' })
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(toggle)
    expect(onChange).not.toHaveBeenCalled()
  })
})
