import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BookRead } from '@/lib/api'
import type * as ApiModule from '@/lib/api'
import ar from '@/locales/ar.json'

import { RecordsList } from './RecordsList'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return { ...actual, api: { ...actual.api, listTemplates: vi.fn().mockResolvedValue({ items: [] }) } }
})

const book: BookRead = {
  id: 1,
  ref_number: 'GS-0001',
  category_id: null,
  subject: 'Subject',
  direction: 'incoming',
  stamp_style: null,
  created_at: '2026-01-01T10:00:00',
  deleted_at: null,
  urgency: 'Normal',
  approval_state: 'none',
  access_scope: 'full',
  grade: 'unclassified',
  distribution: 'named',
  metadata_only: false,
  can_write: false,
  can_send: false,
  can_change_grade: false,
  can_sign: false,
  can_review: false,
  is_draft: false,
  doc_manager_has_signature: false,
  is_word_book: false,
  included_papers_revision: 0,
  included_papers_fixed_page_count: 0,
  included_papers_total_page_count: 0,
  current_template_id: null,
  service_id: 'General Book',
  created_by_name: 'Sara',
  versions: [],
  attachment_paths: [],
}

function LocationProbe(): React.JSX.Element {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function setup(withMenu = true) {
  const onSelect = vi.fn()
  const onMenuOpen = vi.fn()
  const onAction = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/books']}>
        <RecordsList
          rows={[book]}
          selectedId={null}
          onSelect={onSelect}
          nav={() => ({ from: '/books', queue: [1], scrollY: 0 })}
          isInmateReporter={false}
          rowMenu={withMenu ? () => [
            { key: 'first', label: 'First action', icon: null, onSelect: onAction },
            { key: 'second', label: 'Second action', icon: null, onSelect: onAction },
          ] : undefined}
          onRowMenuOpen={onMenuOpen}
        />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onSelect, onMenuOpen, onAction }
}

function rowControls() {
  const select = screen.getByRole('button', { name: /Sara/ })
  const trigger = screen.getByRole('button', { name: /GS-0001/ })
  return { select, trigger }
}

beforeEach(async () => {
  i18n.addResourceBundle('ar', 'translation', ar)
  await i18n.changeLanguage('en')
})

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('desktop record row menu', () => {
  it.each([
    ['row', '{Shift>}{F10}{/Shift}'],
    ['row', '{ContextMenu}'],
    ['trigger', '{Shift>}{F10}{/Shift}'],
    ['trigger', '{ContextMenu}'],
  ])('opens from the focused %s with %s and Escape restores that control', async (origin, keys) => {
    const user = userEvent.setup()
    const { onSelect, onMenuOpen } = setup()
    const { select, trigger } = rowControls()
    const control = origin === 'row' ? select : trigger
    control.focus()

    await user.keyboard(keys)

    const menu = await screen.findByRole('menu')
    const first = within(menu).getByRole('menuitem', { name: 'First action' })
    await waitFor(() => expect(first).toHaveFocus())
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(onMenuOpen).toHaveBeenCalledExactlyOnceWith(book)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/books$/)

    await user.keyboard('{ArrowDown}')
    expect(within(menu).getByRole('menuitem', { name: 'Second action' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await waitFor(() => expect(control).toHaveFocus())
  })

  it.each(['row', 'trigger', 'background'])('right-clicking the %s does not select it and Escape restores its control', async (origin) => {
    const user = userEvent.setup()
    const { onSelect, onMenuOpen } = setup()
    const { select, trigger } = rowControls()
    const control = origin === 'trigger' ? trigger : select
    const target = origin === 'background' ? select.closest('[data-book-id]')! : control

    expect(fireEvent.contextMenu(target)).toBe(false)
    await screen.findByRole('menu')
    expect(onMenuOpen).toHaveBeenCalledExactlyOnceWith(book)
    expect(onSelect).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(control).toHaveFocus())
  })

  it('clicking the trigger and choosing an item only invokes that action', async () => {
    const user = userEvent.setup()
    const { onSelect, onAction } = setup()
    await user.click(rowControls().trigger)
    await user.click(await screen.findByRole('menuitem', { name: 'First action' }))
    expect(onAction).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/books$/)
  })

  it('leaves the reference link context menu to the browser', () => {
    const { onSelect, onMenuOpen } = setup()
    expect(fireEvent.contextMenu(screen.getByRole('link', { name: 'GS-0001' }))).toBe(true)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onMenuOpen).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('has no trigger or custom context/keyboard menu without rowMenu', async () => {
    const user = userEvent.setup()
    const { onSelect, onMenuOpen } = setup(false)
    const select = screen.getByRole('button', { name: /Sara/ })
    expect(screen.queryByRole('button', { name: /GS-0001/ })).not.toBeInTheDocument()
    select.focus()
    await user.keyboard('{Shift>}{F10}{/Shift}{ContextMenu}')
    expect(fireEvent.contextMenu(select)).toBe(true)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onMenuOpen).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it.each([['en', 'ltr'], ['ar', 'rtl']])('uses %s direction on the portalled menu', async (language, direction) => {
    await i18n.changeLanguage(language)
    const user = userEvent.setup()
    setup()
    await user.click(rowControls().trigger)
    const menu = await screen.findByRole('menu')
    expect(menu).toHaveAttribute('dir', direction)
    expect(menu).toHaveAttribute('data-align', 'end')
  })
})
