import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu'

type ItemProps = Omit<React.ComponentProps<typeof DropdownMenuItem>, 'children'>

async function openMenu(item: React.ReactNode) {
  const user = userEvent.setup()
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
      <DropdownMenuContent>{item}</DropdownMenuContent>
    </DropdownMenu>,
  )
  await user.click(screen.getByRole('button', { name: 'Actions' }))
  return user
}

const menuItem = (name: RegExp | string): HTMLElement => screen.getByRole('menuitem', { name })

function plain(props: ItemProps): React.ReactNode {
  return <DropdownMenuItem {...props}>Delete</DropdownMenuItem>
}

describe('DropdownMenuItem', () => {
  it('selects and closes the menu when nothing blocks it', async () => {
    const onSelect = vi.fn()
    const user = await openMenu(plain({ onSelect }))
    await user.click(menuItem('Delete'))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  describe('reason', () => {
    const reason = 'In-flight records can’t be deleted.'

    it('is aria-disabled, shows and describes the reason, and stays focusable', async () => {
      await openMenu(plain({ reason, onSelect: vi.fn() }))
      const item = menuItem(/Delete/)
      expect(item).toHaveAttribute('aria-disabled', 'true')
      expect(item).not.toHaveAttribute('data-disabled')
      expect(screen.getByText(reason)).toBeVisible()
      const describedBy = item.getAttribute('aria-describedby')
      expect(describedBy).toBeTruthy()
      expect(document.getElementById(describedBy!)).toHaveTextContent(reason)
      item.focus()
      expect(item).toHaveFocus()
    })

    it('ignores click and keyboard activation and keeps the menu open', async () => {
      const onSelect = vi.fn()
      const user = await openMenu(plain({ reason, onSelect }))
      const item = menuItem(/Delete/)
      await user.click(item)
      item.focus()
      await user.keyboard('{Enter}')
      await user.keyboard(' ')
      expect(onSelect).not.toHaveBeenCalled()
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('drops the shortcut hint while blocked', async () => {
      await openMenu(plain({ reason, shortcut: 'Ctrl+K' }))
      const item = menuItem(/Delete/)
      expect(item).not.toHaveAttribute('aria-keyshortcuts')
      expect(item).not.toHaveTextContent('Ctrl+K')
    })
  })

  describe('pending', () => {
    it('is busy and aria-disabled, shows a spinner, and never selects', async () => {
      const onSelect = vi.fn()
      const user = await openMenu(plain({ pending: true, onSelect, shortcut: 'E' }))
      const item = menuItem('Delete')
      expect(item).toHaveAttribute('aria-busy', 'true')
      expect(item).toHaveAttribute('aria-disabled', 'true')
      expect(item.querySelector('svg.animate-spin')).not.toBeNull()
      expect(item.querySelector('kbd')).toBeNull()
      await user.click(item)
      expect(onSelect).not.toHaveBeenCalled()
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })
  })

  describe('shortcut', () => {
    it('renders the key hint and aria-keyshortcuts on an available item', async () => {
      await openMenu(plain({ shortcut: 'E', onSelect: vi.fn() }))
      const item = menuItem(/Delete/)
      expect(item).toHaveAttribute('aria-keyshortcuts', 'E')
      expect(item).toHaveTextContent('E')
      expect(item).not.toHaveAttribute('aria-disabled')
    })
  })

  describe('asChild', () => {
    const reason = 'Finish the Word session first.'

    it('with a reason: renders and links the reason, and neither fires onClick nor navigates', async () => {
      const onClick = vi.fn()
      await openMenu(
        <DropdownMenuItem asChild reason={reason}>
          <a href="#next" onClick={onClick}>
            Open
          </a>
        </DropdownMenuItem>,
      )
      const item = menuItem(/Open/)
      expect(item.tagName).toBe('A')
      expect(item).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByText(reason)).toBeVisible()
      const describedBy = item.getAttribute('aria-describedby')
      expect(document.getElementById(describedBy!)).toHaveTextContent(reason)
      // fireEvent.click returns false when the default action (navigation) was prevented.
      expect(fireEvent.click(item)).toBe(false)
      expect(onClick).not.toHaveBeenCalled()
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('without a reason: behaves as the child (click reaches it, menu closes)', async () => {
      const onClick = vi.fn()
      const user = await openMenu(
        <DropdownMenuItem asChild>
          <a href="#next" onClick={onClick}>
            Open
          </a>
        </DropdownMenuItem>,
      )
      await user.click(menuItem('Open'))
      expect(onClick).toHaveBeenCalledOnce()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })
})
