import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { api, type BookRead, type Grade } from '@/lib/api'
import i18n from '@/lib/i18n'
import { ChangeGradeDialog } from './ChangeGradeDialog'

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))

const book = (grade: Grade): BookRead => ({ id: 7, ref_number: '1/1/7', grade }) as BookRead

function Host({ grade, menu = false }: { grade: Grade; menu?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(menu)
  return (
    <QueryClientProvider client={new QueryClient()}>
      <button id="row-menu" type="button" onClick={() => setMenuOpen(true)}>Row menu</button>
      {!menu && <button type="button" onClick={() => setOpen(true)}>Open</button>}
      {menu && menuOpen && (
        <div role="menu" aria-labelledby="row-menu">
          <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); setOpen(true) }}>Change grade</button>
        </div>
      )}
      <ChangeGradeDialog book={book(grade)} open={open} onOpenChange={setOpen} />
    </QueryClientProvider>
  )
}

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await i18n.changeLanguage('en') })

it('raising the grade applies at once', async () => {
  const set = vi.spyOn(api, 'setBookGrade').mockResolvedValue(book('secret'))
  render(<Host grade="unclassified" />)
  await userEvent.click(screen.getByRole('button', { name: 'Open' }))
  await userEvent.selectOptions(screen.getByLabelText('Grade'), 'secret')
  await userEvent.click(screen.getByRole('button', { name: 'Save grade' }))
  await waitFor(() => expect(set).toHaveBeenCalledWith(7, 'secret'))
})

it.each([['en', 'Lower this record\'s grade?'], ['ar', 'خفض درجة سرية المعاملة؟']])('lowering the grade asks first, focusing Cancel (%s)', async (lng, title) => {
  await i18n.changeLanguage(lng)
  const set = vi.spyOn(api, 'setBookGrade').mockResolvedValue(book('unclassified'))
  render(<Host grade="secret" />)
  await userEvent.click(screen.getByRole('button', { name: 'Open' }))
  await userEvent.selectOptions(screen.getByLabelText(i18n.t('books.grade.label')), 'unclassified')
  await userEvent.click(screen.getByRole('button', { name: i18n.t('books.grade.save') }))
  const confirm = await screen.findByRole('alertdialog', { name: title }).catch(() => screen.findByRole('dialog', { name: title }))
  expect(set).not.toHaveBeenCalled()
  expect(within(confirm).getByRole('button', { name: i18n.t('common.cancel') })).toHaveFocus()
  await userEvent.click(within(confirm).getByRole('button', { name: i18n.t('common.cancel') }))
  expect(set).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: i18n.t('books.grade.save') }))
  await userEvent.click(within(await screen.findByRole('dialog', { name: title })).getByRole('button', { name: i18n.t('books.grade.save') }))
  await waitFor(() => expect(set).toHaveBeenCalledWith(7, 'unclassified'))
})

it('Escape returns focus to the menu trigger even though the menu item that opened the dialog is gone', async () => {
  render(<Host grade="secret" menu />)
  screen.getByRole('menuitem', { name: 'Change grade' }).focus()
  await userEvent.click(screen.getByRole('menuitem', { name: 'Change grade' }))
  await screen.findByRole('dialog', { name: 'Change grade' })
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByRole('button', { name: 'Row menu' })).toHaveFocus())
})
