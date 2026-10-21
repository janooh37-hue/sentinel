import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'

import ar from '@/locales/ar.json'

import type { MessageTemplateRead } from '@/lib/messageTemplates'
import type { DraftVariant } from '@/lib/draftTemplates'

const state = vi.hoisted(() => ({
  messages: [] as MessageTemplateRead[],
  variants: [] as DraftVariant[],
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}))

vi.mock('@/lib/messageTemplates', () => ({
  useMessageTemplates: () => ({ data: state.messages, isLoading: state.isLoading, isError: state.isError, refetch: state.refetch }),
}))
vi.mock('@/lib/draftTemplates', () => ({ useDraftVariants: () => state.variants }))
vi.mock('@/pages/books/serviceLabels', () => ({ useServiceLabel: () => (service: string) => service }))
vi.mock('@/components/templates/MessageTemplateEditor', () => ({
  MessageTemplateEditor: ({ template }: { template: MessageTemplateRead }) => <input aria-label={`Editor ${template.event}`} defaultValue="Unsaved wording" />,
}))
vi.mock('@/components/templates/EmailDraftEditor', () => ({
  EmailDraftEditor: ({ draftKey }: { draftKey: string }) => <div>Draft editor {draftKey}</div>,
}))

import { MessageTemplatesSection } from './MessageTemplatesSection'

function message(event: string, group: MessageTemplateRead['group'], services: string[]): MessageTemplateRead {
  return { event, group, services, label: { en: event, ar: event }, timing: 'on_save', default: { en: 'Default', ar: 'النص' }, override: null, variables: [] }
}

beforeEach(() => {
  state.messages = [
    message('leave_approved', 'leaves', ['leaves']),
    message('salary_transfer', 'forms', ['Salary Transfer Request']),
    message('passport_release', 'forms', ['Passport Release Form']),
    message('violation', 'violations', ['violations']),
    message('leave_ending', 'reminders', ['leaves']),
  ]
  state.variants = ['leave:Sick Leave', 'Salary Transfer Request', 'General Book', 'General Book:transfer', 'classification:1/1', 'absence:absent', 'absence:returned'].map((key) => ({ key, label: { en: key, ar: key }, services: [] }))
  state.isLoading = false
  state.isError = false
  state.refetch.mockClear()
})

afterEach(async () => { await act(async () => { await i18n.changeLanguage('en') }) })

describe('MessageTemplatesSection', () => {
  it('lists every employee event and draft under its service family', () => {
    render(<MessageTemplatesSection />)
    const employee = screen.getByRole('region', { name: 'Employee messages' })
    const drafts = screen.getByRole('region', { name: 'Email drafts' })
    for (const template of state.messages) {
      expect(within(employee).getByText(template.event)).toBeInTheDocument()
    }
    expect(within(employee).getByRole('region', { name: 'Leaves' })).toHaveTextContent('leave_approved')
    expect(within(employee).getByRole('region', { name: 'Reminders' })).toHaveTextContent('leave_ending')
    const forms = within(employee).getByRole('region', { name: 'Forms' })
    expect(within(forms).getByRole('heading', { name: 'Salary Transfer Request' })).toBeInTheDocument()
    expect(within(forms).getByRole('heading', { name: 'Passport Release Form' })).toBeInTheDocument()
    expect(within(employee).getByRole('region', { name: 'Violations' })).toHaveTextContent('violation')
    for (const variant of state.variants) {
      expect(within(drafts).getByText(variant.key)).toBeInTheDocument()
    }
    expect(within(drafts).getByRole('region', { name: 'Leaves' })).toHaveTextContent('leave:Sick Leave')
    expect(within(drafts).getByRole('region', { name: 'Forms' })).toHaveTextContent('Salary Transfer Request')
    expect(within(drafts).getByRole('region', { name: 'General Book classifications' })).toHaveTextContent('classification:1/1')
    expect(within(drafts).getByRole('region', { name: 'Absences' })).toHaveTextContent('absence:returned')
    expect(screen.queryByLabelText('Editor leave_approved')).not.toBeInTheDocument()
  })

  it('opens the shared editors and retains unsaved wording while collapsed', async () => {
    render(<MessageTemplatesSection />)
    const row = screen.getByText('leave_approved').closest('details')!
    row.open = true
    fireEvent(row, new Event('toggle'))
    const input = await screen.findByLabelText('Editor leave_approved')
    fireEvent.change(input, { target: { value: 'Keep this edit' } })
    row.open = false
    fireEvent(row, new Event('toggle'))
    row.open = true
    fireEvent(row, new Event('toggle'))
    expect(input).toHaveValue('Keep this edit')
    const draftRow = screen.getByText('classification:1/1').closest('details')!
    draftRow.open = true
    fireEvent(draftRow, new Event('toggle'))
    expect(await screen.findByText('Draft editor classification:1/1')).toBeInTheDocument()
  })

  it('keeps drafts available when employee messages fail and offers retry', () => {
    state.isError = true
    render(<MessageTemplatesSection />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load employee message templates.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(state.refetch).toHaveBeenCalledOnce()
    expect(screen.getByText('classification:1/1')).toBeInTheDocument()
  })

  it('uses Arabic headings, labels and direction', async () => {
    i18n.addResourceBundle('ar', 'translation', ar)
    await act(async () => { await i18n.changeLanguage('ar') })
    state.messages[0].label.ar = 'اعتماد الإجازة'
    state.variants[0].label.ar = 'إجازة مرضية'
    const { container } = render(<MessageTemplatesSection />)
    expect(container.firstElementChild).toHaveAttribute('dir', 'rtl')
    expect(screen.getByRole('region', { name: 'رسائل الموظفين' })).toHaveTextContent('اعتماد الإجازة')
    expect(screen.getByRole('region', { name: 'مسودات البريد الإلكتروني' })).toHaveTextContent('إجازة مرضية')
    expect(screen.getAllByRole('region', { name: 'الإجازات' })).toHaveLength(2)
  })
})
