import { useState } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminUserRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import ar from '@/locales/ar.json'
import type { ResourceSearchProps } from '../contracts'
import { StudioSearch } from './StudioSearch'
import { accountSearchIndex, resourceSearchIndex, searchEntries, type SearchEntry } from './searchIndex'

function account(id: number, employee: string, name = 'Ahmed'): AdminUserRead & { name_ar: string } {
  return { id, employee_id: employee, email: `person${id}@example.test`, display_name: name, name_en: name, name_ar: 'أَحْمَد', role: 'operator', status: 'active', failed_attempts: 0, last_login_at: null, created_at: null, is_default_manager: false, password_change_required: false }
}
const accounts = [account(1, 'G123'), account(2, 'G124')]
function query(value: string) {
  const field = screen.getByRole('combobox')
  fireEvent.change(field, { target: { value } })
  return field
}

function templateItem(id = 'admin_leave', label = 'Administrative leave'): ResourceSearchProps['items'][number] {
  return {
    resource: { kind: 'notification_template', id }, group_id: 'templates',
    label: { en: label, ar: 'إجازة إدارية' },
    description: { en: 'Notification wording', ar: 'نص الإشعارات' },
    aliases: { en: ['leave notice'], ar: ['إشعار الإجازة'] },
    actions: (['view', 'edit', 'reset'] as const).map((action) => ({
      action, authorization: 'allowed', executable_now: true, configurable: true,
      setting_capabilities: action === 'view' ? [`messages.templates.view.notify.${id}`] : ['messages.templates'],
      editable_effects: ['grant', 'deny', null], rule_id: `template.${action}`,
      reasons: [], reason_tree: { op: 'all', children: [] }, required_context: [], warnings: [],
    })),
  }
}

afterEach(async () => { await i18n.changeLanguage('en') })

describe('StudioSearch', () => {
  it('reports live resource matches once per changed result set and clears them with the query', () => {
    const onMatchesChange = vi.fn()
    const navigate = vi.fn()
    const item = templateItem()
    const view = render(<StudioSearch subjectId={7} items={[item]} onNavigate={navigate} onMatchesChange={onMatchesChange} />)
    expect(onMatchesChange).toHaveBeenCalledExactlyOnceWith([])
    query('leave notice')
    expect(onMatchesChange).toHaveBeenLastCalledWith([item.resource])
    expect(onMatchesChange).toHaveBeenCalledTimes(2)
    expect(navigate).not.toHaveBeenCalled()
    view.rerender(<StudioSearch subjectId={7} items={[{ ...item }]} onNavigate={navigate} onMatchesChange={onMatchesChange} />)
    expect(onMatchesChange).toHaveBeenCalledTimes(2)
    query('')
    expect(onMatchesChange).toHaveBeenLastCalledWith([])
    expect(onMatchesChange).toHaveBeenCalledTimes(3)
  })

  it('groups one human-labelled resource with its breadcrumb and exact-action chips', () => {
    const navigate = vi.fn()
    render(<StudioSearch subjectId={7} items={[templateItem()]} onNavigate={navigate} />)
    const field = query('leave notice')
    const group = screen.getByRole('group', { name: /Templates & notifications.*Administrative leave/ })
    expect(screen.getAllByRole('group')).toHaveLength(1)
    expect(screen.getAllByText('Administrative leave')).toHaveLength(1)
    expect(within(group).getAllByRole('option')).toHaveLength(3)
    expect(screen.getByRole('status')).toHaveTextContent('1 result')
    expect(group).not.toHaveTextContent('admin_leave')
    expect(group).not.toHaveTextContent('messages.templates')
    expect(field).not.toHaveAttribute('aria-activedescendant')
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(within(group).getByRole('option', { name: 'Administrative leave · Reset to default' }))
    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      userId: 7, resource: { kind: 'notification_template', id: 'admin_leave' }, action: 'reset',
    })
  })

  it('shows only the exactly queried resource or action identifier, never the other technical IDs', () => {
    render(<StudioSearch subjectId={7} items={[templateItem()]} onNavigate={vi.fn()} />)
    query('admin_')
    expect(screen.getByRole('group')).not.toHaveTextContent('admin_leave')
    query('admin_leave')
    let group = screen.getByRole('group')
    expect(within(group).getByText('admin_leave')).toBeVisible()
    expect(group).not.toHaveTextContent('notification_template:admin_leave:edit')
    expect(group).not.toHaveTextContent('messages.templates')
    query('notification_template:admin_leave:edit')
    group = screen.getByRole('group')
    expect(within(group).getByText('notification_template:admin_leave:edit')).toBeVisible()
    expect(within(group).queryByText('admin_leave')).not.toBeInTheDocument()
    expect(group).not.toHaveTextContent('messages.templates')
  })

  it('manually selects the exact action ID, retains every sibling chip, and exposes its active descendant', () => {
    const navigate = vi.fn()
    render(<StudioSearch subjectId={7} items={[templateItem()]} onNavigate={navigate} />)
    const field = query('notification_template:admin_leave:reset')
    expect(screen.getAllByRole('option')).toHaveLength(3)
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    const selected = screen.getByRole('option', { selected: true })
    expect(selected).toHaveAccessibleName('Administrative leave · Reset to default')
    expect(field).toHaveAttribute('aria-activedescendant', selected.id)
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      userId: 7, resource: { kind: 'notification_template', id: 'admin_leave' }, action: 'reset',
    })
  })

  it('does not substitute a sibling action after the selected action disappears', () => {
    const navigate = vi.fn()
    const item = templateItem()
    const view = render(<StudioSearch subjectId={7} items={[item]} onNavigate={navigate} />)
    const field = query('notification_template:admin_leave:reset')
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    view.rerender(<StudioSearch subjectId={7} items={[{ ...item, actions: item.actions.filter((action) => action.action !== 'reset') }]} onNavigate={navigate} />)
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeVisible()
  })

  it('presents Arabic labels, breadcrumb and actions while matching English resource and action text', async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await act(async () => { await i18n.changeLanguage('ar') })
    const navigate = vi.fn()
    render(<div dir="rtl"><StudioSearch subjectId={7} items={[templateItem()]} onNavigate={navigate} /></div>)
    const field = query('Reset to default')
    const group = screen.getByRole('group')
    expect(group).toHaveAccessibleName(`${i18n.t('access.studio.groups.templates')} إجازة إدارية`)
    expect(within(group).getByText('إجازة إدارية')).toBeVisible()
    expect(group).not.toHaveTextContent('Administrative leave')
    expect(group).not.toHaveTextContent('admin_leave')
    expect(field).toHaveAttribute('dir', 'auto')
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent(i18n.t('access.studio.search.actions.reset'))
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      userId: 7, resource: { kind: 'notification_template', id: 'admin_leave' }, action: 'reset',
    })
  })

  it('navigates to an exact resource/action without any mutation and clears selection across subjects', () => {
    const navigate = vi.fn()
    const items: ResourceSearchProps['items'] = [{
      resource: { kind: 'notification_template', id: 'email' }, group_id: 'templates',
      label: { en: 'Message wording', ar: 'صياغة الإشعار' },
      description: { en: 'Notification email wording', ar: 'صياغة البريد الإلكتروني' },
      aliases: { en: ['notification wording'], ar: ['نص الإشعار'] },
      actions: [{ action: 'edit', authorization: 'denied', executable_now: false,
        configurable: true, setting_capabilities: ['messages.templates'], editable_effects: ['grant', 'deny', null],
        rule_id: 'template.edit', reasons: [], reason_tree: { op: 'all', children: [] }, required_context: [], warnings: [] }],
    }]
    const view = render(<StudioSearch subjectId={1} items={items} onNavigate={navigate} />)
    let field = query('نص الإشعار')
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    view.rerender(<StudioSearch subjectId={2} items={items} onNavigate={navigate} />)
    field = screen.getByRole('combobox')
    expect(field).toHaveValue('')
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(navigate).not.toHaveBeenCalled()
    field = query('messages.templates')
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ userId: 2, resource: { kind: 'notification_template', id: 'email' }, action: 'edit' })
  })

  it('does not autofocus or select a duplicate person implicitly; Enter only navigates after manual selection', () => {
    const navigate = vi.fn()
    render(<StudioSearch mode="accounts" accounts={accounts} onNavigate={navigate} />)
    const field = query('Ahmed')
    expect(field).not.toHaveFocus()
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByText('person1@example.test')).toBeVisible()
    expect(screen.getByText('G124')).toBeVisible()
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ userId: 2 })
    expect(field).toHaveAttribute('aria-expanded', 'false')
  })

  it('matches stored Arabic names in English locale and keeps numeric identifiers exact', () => {
    const index = accountSearchIndex(accounts)
    expect(searchEntries(index, 'احمد').map(({ entry }) => entry.destination.userId)).toEqual([1, 2])
    expect(searchEntries(index, 'G١٢٣').map(({ entry }) => entry.destination.userId)).toEqual([1])
    expect(searchEntries(index, 'G12')).toEqual([])
    expect(searchEntries(index, 'G125')).toEqual([])
  })

  it('Escape closes only results, Tab remains native, and composition Enter never opens', () => {
    const navigate = vi.fn()
    render(<StudioSearch mode="accounts" accounts={accounts} onNavigate={navigate} />)
    const field = query('Ahmed')
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true })
    expect(navigate).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true)
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(field).toHaveValue('Ahmed')
    expect(field).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not navigate to a replacement when selected metadata becomes stale', () => {
    const navigate = vi.fn()
    const view = render(<StudioSearch mode="accounts" accounts={accounts} onNavigate={navigate} />)
    const field = query('Ahmed')
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    view.rerender(<StudioSearch mode="accounts" accounts={[accounts[1]]} onNavigate={navigate} />)
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeVisible()
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ userId: 2 })
  })

  it('touch/click selection navigates only to the supplied identity', () => {
    const navigate = vi.fn()
    render(<StudioSearch mode="accounts" accounts={accounts} onNavigate={navigate} />)
    query('G124')
    fireEvent.click(screen.getByRole('option'))
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ userId: 2 })
  })
  it('restores the filtered account query and exact result when returning to the register', () => {
    function RegisterSearch() {
      const [value, setValue] = useState('G124')
      const [visible, setVisible] = useState(true)
      return <>
        <button onClick={() => setVisible((previous) => !previous)}>Switch account view</button>
        {visible && <StudioSearch mode="accounts" accounts={accounts} query={value} onQueryChange={setValue} onNavigate={vi.fn()} />}
      </>
    }
    render(<RegisterSearch />)
    let field = screen.getByRole('combobox')
    expect(field).toHaveValue('G124')
    fireEvent.focus(field)
    expect(screen.getByRole('option')).toHaveTextContent('G124')
    fireEvent.change(field, { target: { value: 'G123' } })
    expect(screen.getByRole('option')).toHaveTextContent('G123')
    fireEvent.click(screen.getByRole('button', { name: 'Switch account view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Switch account view' }))
    field = screen.getByRole('combobox')
    expect(field).toHaveValue('G123')
    fireEvent.focus(field)
    expect(screen.getByRole('option')).toHaveTextContent('G123')
  })
})

function entry(key: string, text: string, aliases: string[] = []): SearchEntry {
  return { key, label: text, alternateLabel: '', text: [text], aliases, identifiers: [key], destination: { userId: 1 } }
}
describe('search ranking', () => {
  it('counts resources once even when several action IDs match the same capability', () => {
    const items = [templateItem(), templateItem('leave_approved', 'Leave approved')]
    const index = resourceSearchIndex({ subjectId: 7, items, onNavigate: vi.fn() }, false)
    expect(index).toHaveLength(2)
    const matches = searchEntries(index, 'messages.templates')
    expect(matches).toHaveLength(2)
    expect(matches.map(({ entry }) => entry.label)).toEqual(['Administrative leave', 'Leave approved'])
    expect(matches[0].actions?.map((action) => action.destination.action)).toEqual(['edit', 'reset', 'view'])
  })

  it('matches employee digits only to the complete employee number, never a database ID', () => {
    const index = accountSearchIndex([account(101, 'G999'), account(7, 'G101')])
    expect(searchEntries(index, '١٠١').map(({ entry }) => entry.destination.userId)).toEqual([7])
    expect(searchEntries(index, '10')).toEqual([])
    expect(searchEntries(index, '7')).toEqual([])
  })

  it('discovers digit-bearing email prefixes without matching partial numeric runs', () => {
    const index = accountSearchIndex([account(1, 'G101'), account(10, 'G110')])
    expect(searchEntries(index, 'person1').map(({ entry }) => entry.destination.userId)).toEqual([1])
    expect(searchEntries(index, 'person١@ex').map(({ entry }) => entry.destination.userId)).toEqual([1])
    expect(searchEntries(index, 'person10').map(({ entry }) => entry.destination.userId)).toEqual([10])
  })

  it('does not duplicate the fallback English name in Arabic presentation', () => {
    const person = { ...account(3, 'G103'), name_ar: '', display_name: 'Ahmed', name_en: '' }
    const [indexed] = accountSearchIndex([person], true)
    expect(indexed.label).toBe('Ahmed')
    expect(indexed.alternateLabel).toBe('')
  })

  it('ranks exact identifiers, strict text, prefixes, aliases, relaxed spelling then typo suggestions', () => {
    expect(searchEntries([entry('alias', 'Other', ['wording']), entry('prefix', 'wording editor'), entry('wording', 'Unrelated'), entry('strict', 'wording')], 'wording').map(({ entry }) => entry.key)).toEqual(['wording', 'strict', 'prefix', 'alias'])
    expect(searchEntries([entry('relaxed', 'فاطمه'), entry('strict', 'فاطمة')], 'فاطمة').map(({ entry }) => entry.key)).toEqual(['strict', 'relaxed'])
    const result = searchEntries([entry('employee', 'Ahmed Mohamed')], 'Ahmd Mohamed')
    expect(result[0]?.suggestion).toBe(true)
  })
  it('searches bilingual descriptions, canonical IDs, and curated aliases without crossing resource identities', () => {
    const entries = [entry('notification_template:email:edit', 'صياغة الإشعار', ['notification email wording']), entry('word_template:letter:edit', 'Word document template')]
    expect(searchEntries(entries, 'notification email wording').map(({ entry }) => entry.key)).toEqual(['notification_template:email:edit'])
    expect(searchEntries(entries, 'notification_template:email:edit')[0]?.rank).toBe(0)
  })
})
