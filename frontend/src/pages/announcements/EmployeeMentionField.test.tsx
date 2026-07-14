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
import { EmployeeMentionField, buildMention } from './EmployeeMentionField'

const emp = {
  id: 'G-1234', name_en: 'Ahmed Al-Sayed', name_ar: 'أحمد السيد',
  position: 'Senior Officer', position_ar: 'ضابط أول',
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

beforeEach(() => {
  mockLang = 'en'
  vi.mocked(api.listEmployees).mockResolvedValue({ items: [emp], total: 1, limit: 6, offset: 0 })
})

describe('EmployeeMentionField', () => {
  it('searches and inserts the formatted mention on pick', async () => {
    const onInsert = vi.fn()
    renderField(onInsert)
    await userEvent.type(screen.getByPlaceholderText('sendToGroup.mention.searchPlaceholder'), 'ahmed')
    await userEvent.click(await screen.findByRole('button', { name: /G-1234/ }))
    expect(onInsert).toHaveBeenCalledWith('Ahmed Al-Sayed (G-1234)')
  })
})
