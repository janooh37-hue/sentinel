import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ar from '@/locales/ar.json'
import type { BookFolderRead } from '@/lib/api'
import { api } from '@/lib/api'

const auth = vi.hoisted(() => ({ role: 'employee' }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, role: auth.role } }) }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => false }))

import { BooksRail } from './BooksRail'
import { BOOK_DRAG_TYPE, bookBoxDragType } from './useBookFolders'

const BASE: BookFolderRead = {
  id: 0, name: '', box: 'incoming', team: false, count: 0, can_manage: true,
  created_by_name: 'Khalid', created_by_name_ar: 'خالد',
  everyone: false, shared_users: [], shared_departments: [],
}
const ZETA: BookFolderRead = { ...BASE, id: 1, name: 'Zeta', count: 2 }
const ALPHA: BookFolderRead = {
  ...BASE, id: 2, name: 'Alpha', team: true,
  shared_users: [{ id: 5, name: 'Aisha', name_ar: 'عائشة', title: null, title_ar: null }],
  shared_departments: ['Operations'],
}
const CLOSED: BookFolderRead = { ...BASE, id: 3, name: 'Closed', box: 'done' }
const OLD: BookFolderRead = { ...BASE, id: 4, name: 'Old', box: 'archived', team: true, everyone: true }

function mount(props: Partial<React.ComponentProps<typeof BooksRail>> = {}) {
  const onSelectScope = vi.fn()
  const onSelectFolder = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><BooksRail scope="incoming" folderId={null} onSelectScope={onSelectScope} onSelectFolder={onSelectFolder} {...props} /></QueryClientProvider>)
  return { onSelectScope, onSelectFolder }
}

const group = (name: string) => screen.queryByRole('group', { name })
const names = (element: HTMLElement) => within(element).getAllByRole('button', { name: /^(?!Folder actions)/ }).map((button) => button.textContent?.replace(/\d+$/, ''))

beforeEach(() => {
  auth.role = 'employee'
  vi.spyOn(api, 'listBookFolders').mockResolvedValue([ZETA, ALPHA, CLOSED, OLD])
  vi.spyOn(api, 'getInboxSummary').mockResolvedValue({ unread: 0, received: 0, sent: 0, archived: 0, by_purpose: { info: 0, action: 0, reply: 0, circulate: 0 } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Books rail folder tree', () => {
  // T-FR1
  it('nests each box\'s own folders under it, personal and shared mixed by name', async () => {
    mount()
    const incoming = await screen.findByRole('group', { name: 'Folders in Incoming' })
    await waitFor(() => expect(names(incoming)).toEqual(['Alpha', 'Zeta']))
    expect(within(incoming).queryByText('Closed')).toBeNull()
    expect(group('Folders in Done')).toBeNull()
    expect(screen.queryByText('My folders')).toBeNull()
    expect(screen.queryByText('Team folders')).toBeNull()
  })

  // T-FR2
  it('selecting a box expands it; the chevron toggles without navigating', async () => {
    const { onSelectScope } = mount()
    const incomingToggle = await screen.findByRole('button', { name: 'Folders in Incoming' })
    expect(incomingToggle).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(incomingToggle)
    expect(incomingToggle).toHaveAttribute('aria-expanded', 'false')
    expect(group('Folders in Incoming')).toBeNull()
    expect(onSelectScope).not.toHaveBeenCalled()

    const doneToggle = screen.getByRole('button', { name: 'Folders in Done' })
    expect(doneToggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onSelectScope).toHaveBeenCalledWith('done')
    expect(doneToggle).toHaveAttribute('aria-expanded', 'true')
    expect(names(group('Folders in Done')!)).toEqual(['Closed'])
  })

  it('expands the box of the selected folder', async () => {
    mount({ scope: null, folderId: OLD.id })
    const archived = await screen.findByRole('group', { name: 'Folders in Archived' })
    expect(within(archived).getByRole('button', { name: /^Old/ })).toHaveAttribute('aria-current', 'page')
  })

  // T-FR3
  it.each([
    ['employee', false],
    ['manager', true],
  ])('creates a folder in the box it was started from (%s)', async (role, team) => {
    auth.role = role
    vi.spyOn(api, 'createBookFolder').mockResolvedValue({ ...CLOSED, id: 9, name: 'Planning' })
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'New folder in Done' }))
    const done = group('Folders in Done')!
    if (team) await userEvent.click(within(done).getByRole('checkbox', { name: 'Share with the team' }))
    else expect(within(done).queryByRole('checkbox')).toBeNull()
    await userEvent.type(within(done).getByRole('textbox', { name: 'Folder name' }), 'Planning{Enter}')
    await waitFor(() => expect(api.createBookFolder).toHaveBeenCalledWith({ name: 'Planning', box: 'done', team }))
  })

  it('moves a folder to another box from the rename form', async () => {
    vi.spyOn(api, 'updateBookFolder').mockResolvedValue({ ...ZETA, box: 'archived' })
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Folder actions: Zeta' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Box' }), 'archived')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.updateBookFolder).toHaveBeenCalledWith(1, { name: 'Zeta', box: 'archived' }))
  })

  // T-FR4
  it('marks a shared folder by icon, name and a tooltip of its members', async () => {
    mount()
    const shared = await screen.findByRole('button', { name: /^Alpha/ })
    const personal = screen.getByRole('button', { name: /^Zeta/ })
    expect(shared).toHaveAccessibleName('Alpha 0, shared folder')
    expect(personal).toHaveAccessibleName('Zeta 2')
    expect(shared.querySelector('svg')?.getAttribute('class')).toContain('lucide-folder-users')
    expect(personal.querySelector('svg')?.getAttribute('class')).not.toContain('lucide-folder-users')
    shared.focus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Shared with: .*Aisha.*Operations.*department/)
  })

  it('says a folder shared with everyone is shared with everyone', async () => {
    mount({ scope: 'archived' })
    ;(await screen.findByRole('button', { name: /^Old/ })).focus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Shared with everyone')
  })

  // T-FR6
  it('accepts a dragged book only on folders of the box it came from', async () => {
    vi.spyOn(api, 'addBookToFolder').mockResolvedValue(undefined)
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Folders in Done' }))
    const data = new Map([[BOOK_DRAG_TYPE, '7'], [bookBoxDragType('incoming'), '']])
    const dataTransfer = { getData: (type: string) => data.get(type) ?? '', get types() { return [...data.keys()] }, dropEffect: 'none' }
    fireEvent.dragStart(document.body, { dataTransfer })
    const target = (name: RegExp) => screen.getByRole('button', { name }).closest('[data-folder-id] > div')!

    const refused = target(/^Closed/)
    expect(fireEvent.dragOver(refused, { dataTransfer })).toBe(true)
    expect(refused).toHaveAttribute('data-drop', 'refused')
    fireEvent.drop(refused, { dataTransfer })
    expect(api.addBookToFolder).not.toHaveBeenCalled()
    // Any drop ends the drag; start the next one.
    fireEvent.dragStart(document.body, { dataTransfer })

    const accepted = target(/^Zeta/)
    expect(fireEvent.dragOver(accepted, { dataTransfer })).toBe(false)
    expect(accepted).toHaveAttribute('data-drop', 'target')
    fireEvent.drop(accepted, { dataTransfer })
    await waitFor(() => expect(api.addBookToFolder).toHaveBeenCalledWith(7, 1))
  })
})

// T-FR7
describe('Books rail folder tree (Arabic)', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => { await i18n.changeLanguage('en') })

  it('names the tree in Arabic and nests folders with logical padding', async () => {
    mount()
    const incoming = await screen.findByRole('group', { name: 'مجلدات الكتب الواردة' })
    expect(screen.getByRole('navigation')).toHaveAttribute('dir', 'rtl')
    expect(incoming.className).toMatch(/\bps-/)
    expect(incoming.className).not.toMatch(/\b(pl|pr|ml|mr)-/)
    expect(screen.getByRole('button', { name: 'مجلد جديد ضمن الكتب المنجزة' })).toBeInTheDocument()
    expect(await within(incoming).findByRole('button', { name: 'Alpha 0، مجلد مشترك' })).toBeInTheDocument()
  })
})
