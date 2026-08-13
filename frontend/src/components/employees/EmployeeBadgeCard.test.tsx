import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { EmployeeListItem } from '@/lib/api'
import { EmployeeBadgeCard } from './EmployeeBadgeCard'

const abdulla: EmployeeListItem = {
  id: 'G3190',
  name_en: 'ABDULLA ALABRI',
  name_ar: 'عبدالله العبري',
  status: 'Active',
  position: 'Officer',
  position_ar: 'ضابط',
  has_photo: false,
} as EmployeeListItem

describe('EmployeeBadgeCard', () => {
  it('renders name, G-number, position, and status', () => {
    render(<EmployeeBadgeCard employee={abdulla} onOpenProfile={() => {}} onClear={() => {}} />)
    expect(screen.getByText('ABDULLA ALABRI')).toBeInTheDocument()
    expect(screen.getByText('G3190')).toBeInTheDocument()
    expect(screen.getByText('Officer')).toBeInTheDocument()
    expect(screen.getByText(/active/i)).toBeInTheDocument()
  })

  it('falls back to name initials when there is no photo', () => {
    render(<EmployeeBadgeCard employee={abdulla} onOpenProfile={() => {}} onClear={() => {}} />)
    expect(screen.getByText('AA')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '' })).not.toBeInTheDocument()
  })

  it('renders the photo endpoint image when has_photo is true', () => {
    render(
      <EmployeeBadgeCard
        employee={{ ...abdulla, has_photo: true }}
        onOpenProfile={() => {}}
        onClear={() => {}}
      />,
    )
    const img = document.querySelector('img[src="/api/v1/employees/G3190/photo"]')
    expect(img).not.toBeNull()
  })

  it('delegates the two actions', async () => {
    const onOpenProfile = vi.fn()
    const onClear = vi.fn()
    render(<EmployeeBadgeCard employee={abdulla} onOpenProfile={onOpenProfile} onClear={onClear} />)
    await userEvent.click(screen.getByRole('button', { name: /open profile/i }))
    expect(onOpenProfile).toHaveBeenCalledWith('G3190')
    await userEvent.click(screen.getByRole('button', { name: /clear employee filter/i }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('marks the decorative reel as aria-hidden', () => {
    const { container } = render(
      <EmployeeBadgeCard employee={abdulla} onOpenProfile={() => {}} onClear={() => {}} />,
    )
    expect(container.querySelector('[data-testid="badge-reel"]')).toHaveAttribute('aria-hidden', 'true')
  })
})
