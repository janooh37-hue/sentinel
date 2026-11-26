import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmployeeListItem } from '@/lib/api'
import { EmployeeBadgeCard } from './EmployeeBadgeCard'

const permissions = vi.hoisted(() => ({ canEdit: false }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    has: (capability: string) => capability === 'employees.edit' && permissions.canEdit,
  }),
}))

const abdulla: EmployeeListItem = {
  id: 'G3190',
  name_en: 'ABDULLA ALABRI',
  name_ar: 'عبدالله العبري',
  status: 'Active',
  position: 'Officer',
  position_ar: 'ضابط',
  department: null,
  has_photo: false,
}

function renderBadge(employee = abdulla, onClear = () => {}) {
  return render(
    <MemoryRouter>
      <EmployeeBadgeCard employee={employee} onClear={onClear} />
    </MemoryRouter>,
  )
}

describe('EmployeeBadgeCard', () => {
  beforeEach(() => {
    permissions.canEdit = false
  })

  it('renders name, G-number, position, and status', () => {
    renderBadge()
    expect(screen.getByText('ABDULLA ALABRI')).toBeInTheDocument()
    expect(screen.getByText('G3190')).toBeInTheDocument()
    expect(screen.getByText('Officer')).toBeInTheDocument()
    expect(screen.getByText(/active/i)).toBeInTheDocument()
  })

  it('falls back to name initials when there is no photo', () => {
    renderBadge()
    expect(screen.getByText('AA')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '' })).not.toBeInTheDocument()
  })

  it('renders the photo endpoint image when has_photo is true', () => {
    renderBadge({ ...abdulla, has_photo: true })
    const img = document.querySelector('img[src="/api/v1/employees/G3190/photo"]')
    expect(img).not.toBeNull()
  })

  it('links to the profile and delegates Reset search', async () => {
    const onClear = vi.fn()
    renderBadge(abdulla, onClear)
    expect(screen.getByRole('link', { name: 'Open profile' })).toHaveAttribute('href', '/employees/G3190')
    await userEvent.click(screen.getByRole('button', { name: 'Reset search' }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('does not render Edit or Change status without employees.edit', () => {
    renderBadge()
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
    expect(screen.queryByText('Change status')).not.toBeInTheDocument()
  })

  it('links to Edit and Change status with employees.edit', () => {
    permissions.canEdit = true
    renderBadge()
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/employees/G3190/edit')
    expect(screen.getByRole('link', { name: 'Change status' })).toHaveAttribute('href', '/employees/G3190?action=status')
  })

  it('marks the decorative reel as aria-hidden', () => {
    const { container } = renderBadge()
    expect(container.querySelector('[data-testid="badge-reel"]')).toHaveAttribute('aria-hidden', 'true')
  })
})
