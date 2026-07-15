// frontend/src/pages/announcements/EmployeeMentionField.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect, beforeEach } from 'vitest'

let mockLang = 'en'
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: mockLang } }),
}))
vi.mock('../../lib/api', () => ({ api: { listEmployees: vi.fn() } }))

import { api, type EmployeeListItem } from '../../lib/api'
import { buildMention } from './mention'
import { EmployeeMentionField } from './EmployeeMentionField'

const emp = {
  id: 'G-1234', name_en: 'Ahmed Al-Sayed', name_ar: 'أحمد السيد',
  position: 'Senior Officer', position_ar: 'ضابط أول',
  contact: '+971509059931',
} as unknown as EmployeeListItem

describe('buildMention', () => {
  it('formats name + G-number, no designation by default', () => {
    expect(buildMention(emp, 'en', false)).toBe('Ahmed Al-Sayed (G-1234)')
  })
  it('appends designation when requested', () => {
    expect(buildMention(emp, 'en', true)).toBe('Ahmed Al-Sayed (G-1234), Senior Officer')
  })
  it('uses Arabic name + designation when lang is ar', () => {
    expect(buildMention(emp, 'ar', true)).toBe('أحمد السيد (G-1234)، ضابط أول')
  })
  it('falls back to the English name when Arabic is missing', () => {
    const noAr = { ...emp, name_ar: null } as EmployeeListItem
    expect(buildMention(noAr, 'ar', false)).toBe('Ahmed Al-Sayed (G-1234)')
  })
})

function renderField(onInsert: (t: string) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <EmployeeMentionField onInsert={onInsert} />
    </QueryClientProvider>,
  )
}

function mockEmployees(items: Partial<EmployeeListItem>[]) {
  vi.mocked(api.listEmployees).mockResolvedValue({
    items: items as EmployeeListItem[],
    total: items.length,
    limit: 6,
    offset: 0,
  })
}

beforeEach(() => {
  mockLang = 'en'
  vi.mocked(api.listEmployees).mockResolvedValue({ items: [emp], total: 1, limit: 6, offset: 0 })
})

describe('EmployeeMentionField', () => {
  it('searches and inserts the formatted mention on pick (plain mode)', async () => {
    const onInsert = vi.fn()
    renderField(onInsert)
    await userEvent.click(screen.getByRole('button', { name: 'sendToGroup.mention.modePlain' }))
    await userEvent.type(screen.getByPlaceholderText('sendToGroup.mention.searchPlaceholder'), 'ahmed')
    await userEvent.click(await screen.findByRole('button', { name: /G-1234/ }))
    expect(onInsert).toHaveBeenCalledWith('Ahmed Al-Sayed (G-1234)', undefined)
  })

  it('tag mode inserts @Name and passes the mention target', async () => {
    mockEmployees([{ id: 'G-1', name_en: 'Omar Al-Rashid', name_ar: null, contact: '+971509059931' }])
    const onInsert = vi.fn()
    renderField(onInsert)
    await userEvent.type(screen.getByPlaceholderText('sendToGroup.mention.searchPlaceholder'), 'om')
    await userEvent.click(await screen.findByRole('button', { name: /Omar Al-Rashid/ }))
    expect(onInsert).toHaveBeenCalledWith('@Omar Al-Rashid ', {
      name: 'Omar Al-Rashid',
      number: '+971509059931',
    })
  })

  it('tag mode disables employees without a number', async () => {
    mockEmployees([{ id: 'G-2', name_en: 'Ghost', name_ar: null, contact: null }])
    renderField(vi.fn())
    await userEvent.type(screen.getByPlaceholderText('sendToGroup.mention.searchPlaceholder'), 'gh')
    expect(await screen.findByRole('button', { name: /Ghost/ })).toBeDisabled()
    expect(screen.getByText('sendToGroup.mention.noNumber')).toBeInTheDocument()
  })

  it('tag mode disables employees whose contact has no usable digits', async () => {
    mockEmployees([{ id: 'G-3', name_en: 'Dots', name_ar: null, contact: '.....' }])
    renderField(vi.fn())
    await userEvent.type(screen.getByPlaceholderText('sendToGroup.mention.searchPlaceholder'), 'do')
    expect(await screen.findByRole('button', { name: /Dots/ })).toBeDisabled()
    expect(screen.getByText('sendToGroup.mention.noNumber')).toBeInTheDocument()
  })

  it('shows modeHint in default tag mode', () => {
    renderField(vi.fn())
    expect(screen.getByText('sendToGroup.mention.modeHint')).toBeInTheDocument()
  })

  it('hides modeHint after switching to plain-name mode', async () => {
    renderField(vi.fn())
    await userEvent.click(screen.getByRole('button', { name: 'sendToGroup.mention.modePlain' }))
    expect(screen.queryByText('sendToGroup.mention.modeHint')).not.toBeInTheDocument()
  })

  it('plain mode inserts buildMention text with no target', async () => {
    mockEmployees([{ id: 'G-1', name_en: 'Omar', name_ar: null, contact: '+971509059931', position: null, position_ar: null }])
    const onInsert = vi.fn()
    renderField(onInsert)
    await userEvent.click(screen.getByRole('button', { name: 'sendToGroup.mention.modePlain' }))
    await userEvent.type(screen.getByPlaceholderText('sendToGroup.mention.searchPlaceholder'), 'om')
    await userEvent.click(await screen.findByRole('button', { name: /Omar \(G-1\)|Omar/ }))
    expect(onInsert).toHaveBeenCalledWith('Omar (G-1)', undefined)
  })
})
