import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set(), isLoading: false, has: () => false }),
}))
vi.mock('@/components/shell/NavBellPopover', () => ({ NavBellPopover: () => null }))
vi.mock('@/components/shell/AccountMenu', () => ({
  AccountMenu: ({ onOpenSettings }: { onOpenSettings?: () => void }) =>
    onOpenSettings ? <button type="button">mobile-settings</button> : null,
}))

import { MobileTopBar } from './MobileTopBar'

it('does not expose the account-menu Settings action without settings.view', () => {
  render(
    <MobileTopBar
      onBurger={vi.fn()}
      onLock={vi.fn()}
      onOpenSettings={vi.fn()}
      onSignOut={vi.fn()}
    />,
  )

  expect(screen.queryByRole('button', { name: 'mobile-settings' })).not.toBeInTheDocument()
})
